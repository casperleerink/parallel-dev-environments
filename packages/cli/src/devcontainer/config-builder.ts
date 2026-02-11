import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DevcontainerConfig } from "./parser.js";

const BUN_FEATURE = "ghcr.io/shyim/devcontainers-features/bun:0";
const BUN_INDICATORS = ["bun.lock", "bun.lockb", "bunfig.toml"];

const NODE_FEATURE = "ghcr.io/devcontainers/features/node:1";
const NODE_INDICATORS = ["package.json"];

const TURBO_FEATURE = "ghcr.io/devcontainers-extra/features/turborepo-npm:1";
const TURBO_INDICATORS = ["turbo.json"];

export interface MergedConfigResult {
	configPath: string;
	additionalFeatures: Record<string, Record<string, unknown>>;
}

export function detectBunUsage(worktreePath: string): boolean {
	return BUN_INDICATORS.some((file) => existsSync(join(worktreePath, file)));
}

export function detectNodeUsage(worktreePath: string): boolean {
	return NODE_INDICATORS.some((file) => existsSync(join(worktreePath, file)));
}

export function detectTurboUsage(worktreePath: string): boolean {
	return TURBO_INDICATORS.some((file) => existsSync(join(worktreePath, file)));
}

export function buildAdditionalFeatures(
	worktreePath: string,
): Record<string, Record<string, unknown>> {
	const features: Record<string, Record<string, unknown>> = {};

	if (detectBunUsage(worktreePath)) {
		features[BUN_FEATURE] = {};
	}

	if (detectNodeUsage(worktreePath)) {
		features[NODE_FEATURE] = {};
	}

	if (detectTurboUsage(worktreePath)) {
		features[TURBO_FEATURE] = {};
	}

	return features;
}

function buildPostCreateCommand(
	existingCommand: DevcontainerConfig["postCreateCommand"],
): Record<string, string> {
	const commands: Record<string, string> = {};

	if (existingCommand) {
		if (typeof existingCommand === "string") {
			commands.project = existingCommand;
		} else if (Array.isArray(existingCommand)) {
			commands.project = existingCommand.join(" ");
		} else if (typeof existingCommand === "object") {
			Object.assign(commands, existingCommand);
		}
	}

	return commands;
}

function buildAppPort(portBindings: Record<string, string>): string[] {
	return Object.entries(portBindings).map(
		([containerPort, hostPort]) => `${hostPort}:${containerPort}`,
	);
}

export async function buildMergedConfig(options: {
	devcontainerConfig: DevcontainerConfig | null;
	worktreePath: string;
	repoPath: string;
	containerEnv: Record<string, string>;
	portBindings: Record<string, string>;
}): Promise<MergedConfigResult> {
	const {
		devcontainerConfig,
		worktreePath,
		repoPath,
		containerEnv,
		portBindings,
	} = options;

	const merged: Record<string, unknown> = {};

	// Start from existing config (minus fields we handle ourselves)
	if (devcontainerConfig) {
		Object.assign(merged, devcontainerConfig);
		// Remove fields we handle via our own mechanisms
		delete merged.forwardPorts;
	}

	// Set default image if no image/dockerFile/dockerComposeFile specified
	if (!merged.image && !merged.dockerFile && !merged.dockerComposeFile) {
		merged.image = "node:24";
	}

	// Default to non-root user so Claude Code --dangerously-skip-permissions works
	// (it refuses to run as root). The node:24 base image includes a "node" user.
	if (!merged.remoteUser) {
		merged.remoteUser = "node";
	}

	// Keep original containerEnv from project config unchanged (stable for Docker layer caching)
	// Put all injected env vars into remoteEnv (applied at runtime, not baked into the image)
	merged.remoteEnv = {
		...containerEnv,
		CLAUDE_CONFIG_DIR: "/devenv-claude-config",
	};

	// Mount host Claude config directory into the container
	const existingMounts = (merged.mounts as string[]) ?? [];
	const repoGitDir = join(repoPath, ".git");
	merged.mounts = [
		...existingMounts,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: apparently this is valid
		"source=${localEnv:HOME}/.claude,target=/devenv-claude-config,type=bind",
		// Mount the parent repo's .git directory at the same absolute path so
		// git worktree references resolve correctly inside the container
		`source=${repoGitDir},target=${repoGitDir},type=bind`,
	];

	// Set appPort from our allocated port bindings
	merged.appPort = buildAppPort(portBindings);

	// Merge postCreateCommand
	const postCreateCommand = buildPostCreateCommand(
		devcontainerConfig?.postCreateCommand,
	);
	// Install AI coding tools at runtime instead of as build features to avoid OOM during Docker build
	postCreateCommand["install-ai-tools"] =
		"npm install -g @anthropic-ai/claude-code @openai/codex";
	// The .git bind mount's parent directory is auto-created by Docker and owned by root.
	// Tools like turbo that follow git worktree references to resolve the repo root
	// will try to write to this directory and fail with permission denied.
	postCreateCommand["fix-git-mount-permissions"] =
		`sudo chown $(whoami) ${repoPath} 2>/dev/null || true`;
	merged.postCreateCommand = postCreateCommand;

	// Build additional features
	const additionalFeatures = buildAdditionalFeatures(worktreePath);

	// Write to temp directory with required filename
	// @devcontainers/cli requires config to be named devcontainer.json or .devcontainer.json
	const configDir = mkdtempSync(join(tmpdir(), "devenv-config-"));
	const configPath = join(configDir, "devcontainer.json");
	await Bun.write(configPath, JSON.stringify(merged, null, 2));

	return { configPath, additionalFeatures };
}
