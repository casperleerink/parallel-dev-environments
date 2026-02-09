import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONTAINER_PORT } from "@repo/shared";

export interface DevcontainerConfig {
	image?: string;
	dockerFile?: string;
	dockerComposeFile?: string;
	forwardPorts?: number[];
	containerEnv?: Record<string, string>;
	remoteEnv?: Record<string, string>;
	postCreateCommand?: string | string[] | Record<string, string>;
	features?: Record<string, Record<string, unknown>>;
	appPort?: string[] | number[];
	[key: string]: unknown;
}

export async function findDevcontainerConfig(
	projectPath: string,
): Promise<DevcontainerConfig | null> {
	const candidates = [
		join(projectPath, ".devcontainer", "devcontainer.json"),
		join(projectPath, ".devcontainer.json"),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			const content = await Bun.file(candidate).text();
			return JSON.parse(content) as DevcontainerConfig;
		}
	}

	return null;
}

export function resolveImage(config: DevcontainerConfig | null): string {
	return config?.image ?? "node:24";
}

export function resolveForwardPorts(
	config: DevcontainerConfig | null,
): number[] {
	if (config?.forwardPorts && config.forwardPorts.length > 0) {
		return config.forwardPorts;
	}
	return [DEFAULT_CONTAINER_PORT];
}

export function resolveEnvVars(
	config: DevcontainerConfig | null,
): Record<string, string> {
	const env: Record<string, string> = {};

	if (config?.containerEnv) {
		Object.assign(env, config.containerEnv);
	}

	if (config?.remoteEnv) {
		Object.assign(env, config.remoteEnv);
	}

	return env;
}

export function resolvePostCreateCommand(
	config: DevcontainerConfig | null,
): string | null {
	if (!config?.postCreateCommand) return null;

	if (Array.isArray(config.postCreateCommand)) {
		return config.postCreateCommand.join(" ");
	}

	if (typeof config.postCreateCommand === "object") {
		return Object.values(config.postCreateCommand).join(" && ");
	}

	return config.postCreateCommand;
}
