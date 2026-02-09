import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverEnvFiles, formatRouteId, generateHostname } from "../envfiles.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "devenv-test-"));
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("discoverEnvFiles", () => {
	test("finds .env files at root level", async () => {
		await writeFile(join(tempDir, ".env"), "KEY=value");
		await writeFile(join(tempDir, ".env.local"), "SECRET=abc");
		await writeFile(join(tempDir, "package.json"), "{}");

		const files = await discoverEnvFiles(tempDir);
		expect(files).toHaveLength(2);
		expect(files[0]!.relativePath).toBe(".env");
		expect(files[0]!.content).toBe("KEY=value");
		expect(files[1]!.relativePath).toBe(".env.local");
		expect(files[1]!.content).toBe("SECRET=abc");
	});

	test("finds .env files in subdirectories", async () => {
		await mkdir(join(tempDir, "apps", "web"), { recursive: true });
		await writeFile(join(tempDir, ".env"), "ROOT=true");
		await writeFile(join(tempDir, "apps", "web", ".env"), "APP=true");

		const files = await discoverEnvFiles(tempDir);
		expect(files).toHaveLength(2);
		expect(files.map((f) => f.relativePath)).toContain(".env");
		expect(files.map((f) => f.relativePath)).toContain(
			join("apps", "web", ".env"),
		);
	});

	test("excludes node_modules and .git directories", async () => {
		await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
		await mkdir(join(tempDir, ".git"), { recursive: true });
		await writeFile(join(tempDir, "node_modules", "pkg", ".env"), "bad");
		await writeFile(join(tempDir, ".git", ".env"), "bad");
		await writeFile(join(tempDir, ".env"), "good");

		const files = await discoverEnvFiles(tempDir);
		expect(files).toHaveLength(1);
		expect(files[0]!.relativePath).toBe(".env");
	});

	test("respects max depth of 2", async () => {
		await mkdir(join(tempDir, "a", "b", "c"), { recursive: true });
		await writeFile(join(tempDir, "a", "b", ".env"), "depth2");
		await writeFile(join(tempDir, "a", "b", "c", ".env"), "depth3");

		const files = await discoverEnvFiles(tempDir);
		expect(files).toHaveLength(1);
		expect(files[0]!.relativePath).toBe(join("a", "b", ".env"));
	});

	test("returns empty array for directory with no env files", async () => {
		await writeFile(join(tempDir, "package.json"), "{}");
		await writeFile(join(tempDir, "README.md"), "# Test");

		const files = await discoverEnvFiles(tempDir);
		expect(files).toHaveLength(0);
	});

	test("finds various .env file patterns", async () => {
		await writeFile(join(tempDir, ".env"), "A=1");
		await writeFile(join(tempDir, ".env.local"), "B=2");
		await writeFile(join(tempDir, ".env.development"), "C=3");
		await writeFile(join(tempDir, ".env.production"), "D=4");
		await writeFile(join(tempDir, ".env.test"), "E=5");

		const files = await discoverEnvFiles(tempDir);
		expect(files).toHaveLength(5);
	});
});

describe("formatRouteId", () => {
	test("prefixes env name with devenv-", () => {
		expect(formatRouteId("myapp-main")).toBe("devenv-myapp-main");
	});

	test("handles complex names", () => {
		expect(formatRouteId("my-project-feature-auth")).toBe(
			"devenv-my-project-feature-auth",
		);
	});
});

describe("generateHostname", () => {
	test("generates hostname for default port", () => {
		expect(generateHostname("myapp", "main")).toBe("myapp-main.localhost");
	});

	test("generates hostname with default container port (3000) omitted", () => {
		expect(generateHostname("myapp", "main", 3000)).toBe(
			"myapp-main.localhost",
		);
	});

	test("generates hostname with non-default port", () => {
		expect(generateHostname("myapp", "main", 8080)).toBe(
			"myapp-main-8080.localhost",
		);
	});

	test("handles special branch names", () => {
		expect(generateHostname("myapp", "feature-auth")).toBe(
			"myapp-feature-auth.localhost",
		);
	});
});
