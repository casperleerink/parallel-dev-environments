import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolveDockerSocket(): string {
	const dockerHost = process.env.DOCKER_HOST;
	if (dockerHost?.startsWith("unix://")) {
		return dockerHost.slice("unix://".length);
	}

	const candidates = [
		join(homedir(), ".docker/run/docker.sock"),
		"/var/run/docker.sock",
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return "/var/run/docker.sock";
}

export const DOCKER_SOCKET = resolveDockerSocket();
export const DOCKER_API_VERSION = "v1.47";
export const CADDY_ADMIN_URL = "http://localhost:2019";
export const CADDY_CONTAINER_NAME = "devenv-caddy";
export const CADDY_IMAGE = "caddy:alpine";
export const DASHBOARD_PORT = 9000;
export const API_PORT = 9001;
export const DEVENV_DIR = ".devenv";
export const DEVENV_WORKTREES_DIR = "worktrees";
export const DEVENV_DB_FILE = "devenv.db";
export const DEFAULT_CONTAINER_PORT = 3000;
export const LOCALHOST_SUFFIX = ".localhost";
export const HOST_PORT_RANGE_START = 49200;
export const CONTAINER_LABEL_PREFIX = "devenv";
export const CONTAINER_WORKSPACE_DIR = "/workspace";
export const CADDY_HOST_GATEWAY = "host.docker.internal";
