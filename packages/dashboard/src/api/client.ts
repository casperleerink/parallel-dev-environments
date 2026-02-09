import { API_PORT } from "@repo/shared";

const API_BASE = `http://localhost:${API_PORT}`;

export interface PortMappingResponse {
	containerPort: number;
	hostPort: number;
	hostname: string;
}

export interface EnvironmentResponse {
	id: number;
	name: string;
	branch: string;
	status: string;
	containerId: string | null;
	portMappings: PortMappingResponse[];
}

export interface ProjectResponse {
	id: number;
	name: string;
	repoPath: string;
	status: string;
	environments: EnvironmentResponse[];
}

export async function fetchProjects(): Promise<ProjectResponse[]> {
	const res = await fetch(`${API_BASE}/api/projects`);
	if (!res.ok) {
		throw new Error(`Failed to fetch projects: ${res.statusText}`);
	}
	return res.json();
}

export async function startEnvironment(envName: string): Promise<void> {
	const res = await fetch(
		`${API_BASE}/api/environments/${encodeURIComponent(envName)}/start`,
		{
			method: "POST",
		},
	);
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error((body as { error: string }).error);
	}
}

export async function stopEnvironment(envName: string): Promise<void> {
	const res = await fetch(
		`${API_BASE}/api/environments/${encodeURIComponent(envName)}/stop`,
		{
			method: "POST",
		},
	);
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error((body as { error: string }).error);
	}
}
