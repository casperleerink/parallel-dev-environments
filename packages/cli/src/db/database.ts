import { Database } from "bun:sqlite";
import {
	DEVENV_DB_FILE,
	DEVENV_DIR,
	HOST_PORT_RANGE_START,
	type Environment,
	type EnvFile,
	type PortMapping,
	type Project,
	type ProjectWithEnvironments,
} from "@repo/shared";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function getDefaultDbPath(): string {
	return join(homedir(), DEVENV_DIR, DEVENV_DB_FILE);
}

export function createDatabase(dbPath?: string): Database {
	const path = dbPath ?? getDefaultDbPath();
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);

	db.exec("PRAGMA journal_mode=WAL;");
	db.exec("PRAGMA foreign_keys=ON;");

	db.exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			repo_path TEXT NOT NULL,
			status TEXT DEFAULT 'active',
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS environments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			project_id INTEGER NOT NULL,
			name TEXT UNIQUE NOT NULL,
			branch TEXT NOT NULL,
			status TEXT DEFAULT 'created',
			container_id TEXT,
			worktree_path TEXT,
			devcontainer_config TEXT,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (project_id) REFERENCES projects(id)
		);

		CREATE TABLE IF NOT EXISTS env_files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			environment_id INTEGER NOT NULL,
			relative_path TEXT NOT NULL,
			content TEXT NOT NULL,
			UNIQUE(environment_id, relative_path),
			FOREIGN KEY (environment_id) REFERENCES environments(id)
		);

		CREATE TABLE IF NOT EXISTS port_mappings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			environment_id INTEGER NOT NULL,
			container_port INTEGER NOT NULL,
			host_port INTEGER UNIQUE NOT NULL,
			hostname TEXT UNIQUE NOT NULL,
			FOREIGN KEY (environment_id) REFERENCES environments(id)
		);
	`);

	return db;
}

interface ProjectRow {
	id: number;
	name: string;
	repo_path: string;
	status: string;
	created_at: string;
	updated_at: string;
}

interface EnvironmentRow {
	id: number;
	project_id: number;
	name: string;
	branch: string;
	status: string;
	container_id: string | null;
	worktree_path: string | null;
	devcontainer_config: string | null;
	created_at: string;
	updated_at: string;
}

interface EnvFileRow {
	id: number;
	environment_id: number;
	relative_path: string;
	content: string;
}

interface PortMappingRow {
	id: number;
	environment_id: number;
	container_port: number;
	host_port: number;
	hostname: string;
}

function mapProject(row: ProjectRow): Project {
	return {
		id: row.id,
		name: row.name,
		repoPath: row.repo_path,
		status: row.status as Project["status"],
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapEnvironment(row: EnvironmentRow): Environment {
	return {
		id: row.id,
		projectId: row.project_id,
		name: row.name,
		branch: row.branch,
		status: row.status as Environment["status"],
		containerId: row.container_id,
		worktreePath: row.worktree_path,
		devcontainerConfig: row.devcontainer_config,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapEnvFile(row: EnvFileRow): EnvFile {
	return {
		id: row.id,
		environmentId: row.environment_id,
		relativePath: row.relative_path,
		content: row.content,
	};
}

function mapPortMapping(row: PortMappingRow): PortMapping {
	return {
		id: row.id,
		environmentId: row.environment_id,
		containerPort: row.container_port,
		hostPort: row.host_port,
		hostname: row.hostname,
	};
}

// Projects

export function insertProject(
	db: Database,
	name: string,
	repoPath: string,
): Project {
	const stmt = db.prepare(
		"INSERT INTO projects (name, repo_path) VALUES (?, ?) RETURNING *",
	);
	return mapProject(stmt.get(name, repoPath) as ProjectRow);
}

export function getProjectByName(
	db: Database,
	name: string,
): Project | null {
	const stmt = db.prepare("SELECT * FROM projects WHERE name = ?");
	const row = stmt.get(name) as ProjectRow | null;
	return row ? mapProject(row) : null;
}

export function getProjectsWithEnvironments(
	db: Database,
): ProjectWithEnvironments[] {
	const projects = db
		.prepare("SELECT * FROM projects ORDER BY name")
		.all() as ProjectRow[];
	const environments = db
		.prepare("SELECT * FROM environments ORDER BY name")
		.all() as EnvironmentRow[];

	return projects.map((p) => ({
		...mapProject(p),
		environments: environments
			.filter((e) => e.project_id === p.id)
			.map(mapEnvironment),
	}));
}

// Environments

export function insertEnvironment(
	db: Database,
	projectId: number,
	name: string,
	branch: string,
	worktreePath?: string,
	devcontainerConfig?: string,
): Environment {
	const stmt = db.prepare(
		"INSERT INTO environments (project_id, name, branch, worktree_path, devcontainer_config) VALUES (?, ?, ?, ?, ?) RETURNING *",
	);
	return mapEnvironment(
		stmt.get(
			projectId,
			name,
			branch,
			worktreePath ?? null,
			devcontainerConfig ?? null,
		) as EnvironmentRow,
	);
}

export function getEnvironmentByName(
	db: Database,
	name: string,
): Environment | null {
	const stmt = db.prepare("SELECT * FROM environments WHERE name = ?");
	const row = stmt.get(name) as EnvironmentRow | null;
	return row ? mapEnvironment(row) : null;
}

export function getEnvironmentsByProject(
	db: Database,
	projectId: number,
): Environment[] {
	const stmt = db.prepare(
		"SELECT * FROM environments WHERE project_id = ? ORDER BY name",
	);
	return (stmt.all(projectId) as EnvironmentRow[]).map(mapEnvironment);
}

export function updateEnvironmentStatus(
	db: Database,
	id: number,
	status: Environment["status"],
): void {
	db.prepare(
		"UPDATE environments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
	).run(status, id);
}

export function updateEnvironmentContainer(
	db: Database,
	id: number,
	containerId: string,
): void {
	db.prepare(
		"UPDATE environments SET container_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
	).run(containerId, id);
}

// Env files

export function upsertEnvFile(
	db: Database,
	environmentId: number,
	relativePath: string,
	content: string,
): void {
	db.prepare(
		`INSERT INTO env_files (environment_id, relative_path, content)
		 VALUES (?, ?, ?)
		 ON CONFLICT(environment_id, relative_path)
		 DO UPDATE SET content = excluded.content`,
	).run(environmentId, relativePath, content);
}

export function getEnvFiles(db: Database, environmentId: number): EnvFile[] {
	const stmt = db.prepare(
		"SELECT * FROM env_files WHERE environment_id = ? ORDER BY relative_path",
	);
	return (stmt.all(environmentId) as EnvFileRow[]).map(mapEnvFile);
}

// Port mappings

export function insertPortMapping(
	db: Database,
	environmentId: number,
	containerPort: number,
	hostPort: number,
	hostname: string,
): PortMapping {
	const stmt = db.prepare(
		"INSERT INTO port_mappings (environment_id, container_port, host_port, hostname) VALUES (?, ?, ?, ?) RETURNING *",
	);
	return mapPortMapping(
		stmt.get(environmentId, containerPort, hostPort, hostname) as PortMappingRow,
	);
}

export function getPortMappings(
	db: Database,
	environmentId: number,
): PortMapping[] {
	const stmt = db.prepare(
		"SELECT * FROM port_mappings WHERE environment_id = ? ORDER BY container_port",
	);
	return (stmt.all(environmentId) as PortMappingRow[]).map(mapPortMapping);
}

export function deletePortMappings(
	db: Database,
	environmentId: number,
): void {
	db.prepare("DELETE FROM port_mappings WHERE environment_id = ?").run(
		environmentId,
	);
}

export function getNextAvailableHostPort(db: Database): number {
	const row = db
		.prepare("SELECT MAX(host_port) as max_port FROM port_mappings")
		.get() as { max_port: number | null };
	return row.max_port ? row.max_port + 1 : HOST_PORT_RANGE_START;
}
