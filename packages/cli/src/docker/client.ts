import {
	CONTAINER_LABEL_PREFIX,
	CONTAINER_WORKSPACE_DIR,
	DOCKER_API_VERSION,
	DOCKER_SOCKET,
} from "@repo/shared";

const DOCKER_BASE_URL = `http://localhost/${DOCKER_API_VERSION}`;

export class DockerError extends Error {
	constructor(
		public statusCode: number,
		message: string,
	) {
		super(message);
		this.name = "DockerError";
	}
}

async function dockerFetch(
	path: string,
	options: RequestInit = {},
): Promise<Response> {
	const res = await fetch(`${DOCKER_BASE_URL}${path}`, {
		...options,
		unix: DOCKER_SOCKET,
	} as RequestInit);

	if (!res.ok) {
		let message = `Docker API error: ${res.status} ${res.statusText}`;
		try {
			const body = (await res.json()) as { message?: string };
			if (body.message) {
				message = body.message;
			}
		} catch {
			// Ignore JSON parse errors
		}
		throw new DockerError(res.status, message);
	}

	return res;
}

export interface CreateContainerOptions {
	name: string;
	image: string;
	workspaceDir?: string;
	cmd?: string[];
	entrypoint?: string[];
	envVars?: string[];
	labels?: Record<string, string>;
	portBindings?: Record<string, string>;
}

interface CreateContainerResponse {
	Id: string;
	Warnings: string[];
}

export async function createContainer(
	options: CreateContainerOptions,
): Promise<string> {
	const {
		name,
		image,
		workspaceDir,
		cmd,
		entrypoint,
		envVars,
		labels,
		portBindings,
	} = options;

	const exposedPorts: Record<string, object> = {};
	const hostPortBindings: Record<string, Array<{ HostPort: string }>> = {};

	if (portBindings) {
		for (const [containerPort, hostPort] of Object.entries(portBindings)) {
			const key = `${containerPort}/tcp`;
			exposedPorts[key] = {};
			hostPortBindings[key] = [{ HostPort: hostPort }];
		}
	}

	const body = {
		Image: image,
		...(cmd ? { Cmd: cmd } : {}),
		...(entrypoint ? { Entrypoint: entrypoint } : {}),
		Env: envVars ?? [],
		Labels: {
			[`${CONTAINER_LABEL_PREFIX}.managed`]: "true",
			...labels,
		},
		ExposedPorts: exposedPorts,
		HostConfig: {
			...(workspaceDir
				? { Binds: [`${workspaceDir}:${CONTAINER_WORKSPACE_DIR}`] }
				: {}),
			PortBindings: hostPortBindings,
		},
		...(workspaceDir ? { WorkingDir: CONTAINER_WORKSPACE_DIR } : {}),
		Tty: true,
		OpenStdin: true,
	};

	const res = await dockerFetch(
		`/containers/create?name=${encodeURIComponent(name)}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	);

	const data = (await res.json()) as CreateContainerResponse;
	return data.Id;
}

export async function startContainer(containerId: string): Promise<void> {
	await dockerFetch(`/containers/${encodeURIComponent(containerId)}/start`, {
		method: "POST",
	});
}

export async function stopContainer(containerId: string): Promise<void> {
	await dockerFetch(`/containers/${encodeURIComponent(containerId)}/stop`, {
		method: "POST",
	});
}

export async function removeContainer(containerId: string): Promise<void> {
	await dockerFetch(
		`/containers/${encodeURIComponent(containerId)}?force=true`,
		{
			method: "DELETE",
		},
	);
}

interface ContainerInspectResponse {
	Id: string;
	Name: string;
	State: {
		Status: string;
		Running: boolean;
	};
	Config: {
		Image: string;
		Labels: Record<string, string>;
	};
	NetworkSettings: {
		Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
	};
}

export async function inspectContainer(
	containerId: string,
): Promise<ContainerInspectResponse> {
	const res = await dockerFetch(
		`/containers/${encodeURIComponent(containerId)}/json`,
	);
	return (await res.json()) as ContainerInspectResponse;
}

export async function pullImage(image: string): Promise<void> {
	const [fromImage = image, tag = "latest"] = image.split(":");
	const res = await dockerFetch(
		`/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
		{ method: "POST" },
	);
	// Read body stream to completion
	await res.text();
}

interface ContainerListItem {
	Id: string;
	Names: string[];
	Image: string;
	State: string;
	Status: string;
	Labels: Record<string, string>;
}

export async function listContainers(
	labelFilter?: string,
): Promise<ContainerListItem[]> {
	let path = "/containers/json?all=true";
	if (labelFilter) {
		const filters = JSON.stringify({ label: [labelFilter] });
		path += `&filters=${encodeURIComponent(filters)}`;
	}
	const res = await dockerFetch(path);
	return (await res.json()) as ContainerListItem[];
}

interface ExecCreateResponse {
	Id: string;
}

export async function execInContainer(
	containerId: string,
	cmd: string[],
): Promise<{ execId: string; start: () => Promise<Response> }> {
	const res = await dockerFetch(
		`/containers/${encodeURIComponent(containerId)}/exec`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				Cmd: cmd,
				AttachStdin: true,
				AttachStdout: true,
				AttachStderr: true,
				Tty: true,
			}),
		},
	);

	const data = (await res.json()) as ExecCreateResponse;

	return {
		execId: data.Id,
		start: () =>
			dockerFetch(`/exec/${encodeURIComponent(data.Id)}/start`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ Detach: false, Tty: true }),
			}),
	};
}
