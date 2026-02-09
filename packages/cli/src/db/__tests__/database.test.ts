import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	createDatabase,
	getEnvFiles,
	getEnvironmentByName,
	getEnvironmentsByProject,
	getNextAvailableHostPort,
	getPortMappings,
	getProjectByName,
	getProjectsWithEnvironments,
	insertEnvironment,
	insertPortMapping,
	insertProject,
	updateEnvironmentContainer,
	updateEnvironmentStatus,
	upsertEnvFile,
} from "../database.js";

let db: Database;

beforeEach(() => {
	db = createDatabase(":memory:");
});

describe("projects", () => {
	test("insert and retrieve by name", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		expect(project.name).toBe("my-project");
		expect(project.repoPath).toBe("/path/to/repo");
		expect(project.status).toBe("active");
		expect(project.id).toBeGreaterThan(0);

		const retrieved = getProjectByName(db, "my-project");
		expect(retrieved).not.toBeNull();
		expect(retrieved?.id).toBe(project.id);
		expect(retrieved?.name).toBe("my-project");
	});

	test("returns null for non-existent project", () => {
		const result = getProjectByName(db, "does-not-exist");
		expect(result).toBeNull();
	});

	test("unique name constraint", () => {
		insertProject(db, "my-project", "/path/to/repo");
		expect(() => insertProject(db, "my-project", "/other/path")).toThrow();
	});
});

describe("environments", () => {
	test("insert and retrieve by name", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(
			db,
			project.id,
			"my-project-main",
			"main",
			"/path/to/worktree",
		);

		expect(env.name).toBe("my-project-main");
		expect(env.branch).toBe("main");
		expect(env.status).toBe("created");
		expect(env.projectId).toBe(project.id);

		const retrieved = getEnvironmentByName(db, "my-project-main");
		expect(retrieved).not.toBeNull();
		expect(retrieved?.id).toBe(env.id);
	});

	test("get environments by project", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		insertEnvironment(db, project.id, "env-main", "main");
		insertEnvironment(db, project.id, "env-dev", "develop");

		const envs = getEnvironmentsByProject(db, project.id);
		expect(envs).toHaveLength(2);
	});

	test("update status", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(db, project.id, "env-main", "main");

		updateEnvironmentStatus(db, env.id, "running");
		const updated = getEnvironmentByName(db, "env-main");
		expect(updated?.status).toBe("running");
	});

	test("update container id", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(db, project.id, "env-main", "main");

		updateEnvironmentContainer(db, env.id, "abc123");
		const updated = getEnvironmentByName(db, "env-main");
		expect(updated?.containerId).toBe("abc123");
	});
});

describe("projects with environments", () => {
	test("returns projects with nested environments", () => {
		const p1 = insertProject(db, "project-a", "/path/a");
		const p2 = insertProject(db, "project-b", "/path/b");
		insertEnvironment(db, p1.id, "a-main", "main");
		insertEnvironment(db, p1.id, "a-dev", "develop");
		insertEnvironment(db, p2.id, "b-main", "main");

		const result = getProjectsWithEnvironments(db);
		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("project-a");
		expect(result[0]?.environments).toHaveLength(2);
		expect(result[1]?.name).toBe("project-b");
		expect(result[1]?.environments).toHaveLength(1);
	});
});

describe("env files", () => {
	test("upsert and retrieve", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(db, project.id, "env-main", "main");

		upsertEnvFile(db, env.id, ".env", "KEY=value");
		upsertEnvFile(db, env.id, ".env.local", "SECRET=abc");

		const files = getEnvFiles(db, env.id);
		expect(files).toHaveLength(2);
		expect(files[0]?.relativePath).toBe(".env");
		expect(files[0]?.content).toBe("KEY=value");
	});

	test("upsert updates existing", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(db, project.id, "env-main", "main");

		upsertEnvFile(db, env.id, ".env", "KEY=old");
		upsertEnvFile(db, env.id, ".env", "KEY=new");

		const files = getEnvFiles(db, env.id);
		expect(files).toHaveLength(1);
		expect(files[0]?.content).toBe("KEY=new");
	});
});

describe("port mappings", () => {
	test("insert and retrieve", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(db, project.id, "env-main", "main");

		const mapping = insertPortMapping(
			db,
			env.id,
			3000,
			49200,
			"my-project-main.localhost",
		);
		expect(mapping.containerPort).toBe(3000);
		expect(mapping.hostPort).toBe(49200);
		expect(mapping.hostname).toBe("my-project-main.localhost");

		const mappings = getPortMappings(db, env.id);
		expect(mappings).toHaveLength(1);
	});

	test("host port uniqueness constraint", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env1 = insertEnvironment(db, project.id, "env-1", "main");
		const env2 = insertEnvironment(db, project.id, "env-2", "dev");

		insertPortMapping(db, env1.id, 3000, 49200, "env-1.localhost");
		expect(() =>
			insertPortMapping(db, env2.id, 3000, 49200, "env-2.localhost"),
		).toThrow();
	});

	test("hostname uniqueness constraint", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env1 = insertEnvironment(db, project.id, "env-1", "main");
		const env2 = insertEnvironment(db, project.id, "env-2", "dev");

		insertPortMapping(db, env1.id, 3000, 49200, "same.localhost");
		expect(() =>
			insertPortMapping(db, env2.id, 3000, 49201, "same.localhost"),
		).toThrow();
	});
});

describe("getNextAvailableHostPort", () => {
	test("returns HOST_PORT_RANGE_START when no mappings", () => {
		const port = getNextAvailableHostPort(db);
		expect(port).toBe(49200);
	});

	test("returns sequential ports", () => {
		const project = insertProject(db, "my-project", "/path/to/repo");
		const env = insertEnvironment(db, project.id, "env-main", "main");

		insertPortMapping(db, env.id, 3000, 49200, "a.localhost");
		expect(getNextAvailableHostPort(db)).toBe(49201);

		insertPortMapping(db, env.id, 8080, 49201, "b.localhost");
		expect(getNextAvailableHostPort(db)).toBe(49202);
	});
});
