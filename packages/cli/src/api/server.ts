import { API_PORT } from "@repo/shared";
import {
	createDatabase,
	getEnvFiles,
	getEnvironmentByName,
	getPortMappings,
	getProjectsWithEnvironments,
	updateEnvironmentStatus,
} from "../db/database.js";
import { startContainer, stopContainer } from "../docker/client.js";
import { addRoute, ensureCaddyRunning, removeRoute } from "../tunnel/caddy.js";
import { formatRouteId } from "../utils/envfiles.js";

interface ProjectResponse {
	id: number;
	name: string;
	repoPath: string;
	status: string;
	environments: EnvironmentResponse[];
}

interface EnvironmentResponse {
	id: number;
	name: string;
	branch: string;
	status: string;
	containerId: string | null;
	portMappings: PortMappingResponse[];
}

interface PortMappingResponse {
	containerPort: number;
	hostPort: number;
	hostname: string;
}

function corsHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

export function startApiServer(): ReturnType<typeof Bun.serve> {
	const server = Bun.serve({
		port: API_PORT,
		async fetch(req) {
			const url = new URL(req.url);
			const { pathname } = url;

			// Handle CORS preflight
			if (req.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: corsHeaders(),
				});
			}

			try {
				if (req.method === "GET" && pathname === "/api/projects") {
					return handleGetProjects();
				}

				const envMatch = pathname.match(/^\/api\/environments\/([^/]+)$/);
				if (envMatch?.[1] && req.method === "GET") {
					return handleGetEnvironment(envMatch[1]);
				}

				const startMatch = pathname.match(
					/^\/api\/environments\/([^/]+)\/start$/,
				);
				if (startMatch?.[1] && req.method === "POST") {
					return await handleStartEnvironment(startMatch[1]);
				}

				const stopMatch = pathname.match(
					/^\/api\/environments\/([^/]+)\/stop$/,
				);
				if (stopMatch?.[1] && req.method === "POST") {
					return await handleStopEnvironment(stopMatch[1]);
				}

				return Response.json(
					{ error: "Not found" },
					{ status: 404, headers: corsHeaders() },
				);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				return Response.json(
					{ error: message },
					{ status: 500, headers: corsHeaders() },
				);
			}
		},
	});

	return server;
}

function handleGetProjects(): Response {
	const db = createDatabase();
	try {
		const projects = getProjectsWithEnvironments(db);

		const response: ProjectResponse[] = projects.map((p) => ({
			id: p.id,
			name: p.name,
			repoPath: p.repoPath,
			status: p.status,
			environments: p.environments.map((e) => {
				const portMappings = getPortMappings(db, e.id);
				return {
					id: e.id,
					name: e.name,
					branch: e.branch,
					status: e.status,
					containerId: e.containerId,
					portMappings: portMappings.map((pm) => ({
						containerPort: pm.containerPort,
						hostPort: pm.hostPort,
						hostname: pm.hostname,
					})),
				};
			}),
		}));

		return Response.json(response, { headers: corsHeaders() });
	} finally {
		db.close();
	}
}

function handleGetEnvironment(envName: string): Response {
	const db = createDatabase();
	try {
		const environment = getEnvironmentByName(db, envName);
		if (!environment) {
			return Response.json(
				{ error: `Environment not found: ${envName}` },
				{ status: 404, headers: corsHeaders() },
			);
		}

		const envFiles = getEnvFiles(db, environment.id);
		const portMappings = getPortMappings(db, environment.id);

		return Response.json(
			{
				...environment,
				envFiles: envFiles.map((f) => ({
					relativePath: f.relativePath,
					content: f.content,
				})),
				portMappings: portMappings.map((pm) => ({
					containerPort: pm.containerPort,
					hostPort: pm.hostPort,
					hostname: pm.hostname,
				})),
			},
			{ headers: corsHeaders() },
		);
	} finally {
		db.close();
	}
}

async function handleStartEnvironment(envName: string): Promise<Response> {
	const db = createDatabase();
	try {
		const environment = getEnvironmentByName(db, envName);
		if (!environment) {
			return Response.json(
				{ error: `Environment not found: ${envName}` },
				{ status: 404, headers: corsHeaders() },
			);
		}

		if (!environment.containerId) {
			return Response.json(
				{ error: `No container associated with environment: ${envName}` },
				{ status: 400, headers: corsHeaders() },
			);
		}

		await startContainer(environment.containerId);
		updateEnvironmentStatus(db, environment.id, "running");

		await ensureCaddyRunning();
		const portMappings = getPortMappings(db, environment.id);
		for (const pm of portMappings) {
			const routeId = formatRouteId(`${envName}-${pm.containerPort}`);
			await addRoute(routeId, pm.hostname, pm.hostPort);
		}

		return Response.json({ status: "started" }, { headers: corsHeaders() });
	} finally {
		db.close();
	}
}

async function handleStopEnvironment(envName: string): Promise<Response> {
	const db = createDatabase();
	try {
		const environment = getEnvironmentByName(db, envName);
		if (!environment) {
			return Response.json(
				{ error: `Environment not found: ${envName}` },
				{ status: 404, headers: corsHeaders() },
			);
		}

		if (!environment.containerId) {
			return Response.json(
				{ error: `No container associated with environment: ${envName}` },
				{ status: 400, headers: corsHeaders() },
			);
		}

		await stopContainer(environment.containerId);
		updateEnvironmentStatus(db, environment.id, "stopped");

		const portMappings = getPortMappings(db, environment.id);
		for (const pm of portMappings) {
			const routeId = formatRouteId(`${envName}-${pm.containerPort}`);
			await removeRoute(routeId);
		}

		return Response.json({ status: "stopped" }, { headers: corsHeaders() });
	} finally {
		db.close();
	}
}
