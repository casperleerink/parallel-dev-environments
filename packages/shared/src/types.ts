export type ProjectStatus = "active" | "archived";

export type EnvironmentStatus = "created" | "running" | "stopped" | "error";

export interface Project {
	id: number;
	name: string;
	repoPath: string;
	status: ProjectStatus;
	createdAt: string;
	updatedAt: string;
}

export interface Environment {
	id: number;
	projectId: number;
	name: string;
	branch: string;
	status: EnvironmentStatus;
	containerId: string | null;
	worktreePath: string | null;
	devcontainerConfig: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface EnvFile {
	id: number;
	environmentId: number;
	relativePath: string;
	content: string;
}

export interface PortMapping {
	id: number;
	environmentId: number;
	containerPort: number;
	hostPort: number;
	hostname: string;
}

export type EnvironmentWithProject = Environment & {
	project: Project;
};

export type ProjectWithEnvironments = Project & {
	environments: Environment[];
};
