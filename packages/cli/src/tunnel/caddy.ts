import {
	CADDY_ADMIN_URL,
	CADDY_CONTAINER_NAME,
	CADDY_HOST_GATEWAY,
	CADDY_IMAGE,
} from "@repo/shared";
import {
	createContainer,
	inspectContainer,
	pullImage,
	startContainer,
	DockerError,
} from "../docker/client.js";

export async function ensureCaddyRunning(): Promise<void> {
	try {
		const info = await inspectContainer(CADDY_CONTAINER_NAME);
		if (!info.State.Running) {
			await startContainer(CADDY_CONTAINER_NAME);
		}
		return;
	} catch (error) {
		if (!(error instanceof DockerError && error.statusCode === 404)) {
			throw error;
		}
	}

	// Check port 80 availability
	try {
		const server = Bun.listen({
			hostname: "0.0.0.0",
			port: 80,
			socket: {
				data() {},
			},
		});
		server.stop();
	} catch {
		throw new Error(
			"Port 80 is in use. Caddy needs port 80 for .localhost routing.",
		);
	}

	// Pull image and create container
	await pullImage(CADDY_IMAGE);

	await createContainer({
		name: CADDY_CONTAINER_NAME,
		image: CADDY_IMAGE,
		workspaceDir: "/dev/null",
		portBindings: {
			"80": "80",
			"2019": "2019",
		},
		labels: {
			"devenv.role": "caddy",
		},
	});

	await startContainer(CADDY_CONTAINER_NAME);
}

async function ensureServerConfig(): Promise<void> {
	try {
		const res = await fetch(
			`${CADDY_ADMIN_URL}/config/apps/http/servers/devenv`,
		);
		if (res.ok) return;
	} catch {
		// Server config doesn't exist yet
	}

	const res = await fetch(
		`${CADDY_ADMIN_URL}/config/apps/http/servers/devenv`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				listen: [":80"],
				routes: [],
			}),
		},
	);

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Failed to initialize Caddy server config: ${body}`);
	}
}

export async function addRoute(
	routeId: string,
	hostname: string,
	hostPort: number,
): Promise<void> {
	await ensureServerConfig();

	// Try to update existing route first via /id/ API
	const route = {
		"@id": routeId,
		match: [{ host: [hostname] }],
		handle: [
			{
				handler: "reverse_proxy",
				upstreams: [{ dial: `${CADDY_HOST_GATEWAY}:${hostPort}` }],
			},
		],
	};

	// Try upsert via /id/ endpoint
	let res = await fetch(`${CADDY_ADMIN_URL}/id/${routeId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(route),
	});

	if (res.ok) return;

	// If route doesn't exist, append it
	res = await fetch(
		`${CADDY_ADMIN_URL}/config/apps/http/servers/devenv/routes`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(route),
		},
	);

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Failed to add Caddy route: ${body}`);
	}
}

export async function removeRoute(routeId: string): Promise<void> {
	const res = await fetch(`${CADDY_ADMIN_URL}/id/${routeId}`, {
		method: "DELETE",
	});

	// Ignore 404 — route may already be removed
	if (!res.ok && res.status !== 404) {
		const body = await res.text();
		throw new Error(`Failed to remove Caddy route: ${body}`);
	}
}

interface CaddyRoute {
	"@id"?: string;
	match?: Array<{ host?: string[] }>;
	handle?: Array<{ handler: string; upstreams?: Array<{ dial: string }> }>;
}

export async function listRoutes(): Promise<CaddyRoute[]> {
	try {
		const res = await fetch(
			`${CADDY_ADMIN_URL}/config/apps/http/servers/devenv/routes`,
		);
		if (!res.ok) return [];
		return (await res.json()) as CaddyRoute[];
	} catch {
		return [];
	}
}
