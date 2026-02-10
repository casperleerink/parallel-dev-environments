import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DevcontainerConfig } from "./parser.js";

const CLAUDE_CODE_FEATURE =
  "ghcr.io/stu-bell/devcontainer-features/claude-code:0";
const CODEX_FEATURE = "ghcr.io/jsburckhardt/devcontainer-features/codex:1";

const BUN_FEATURE = "ghcr.io/shyim/devcontainers-features/bun:0";
const BUN_INDICATORS = ["bun.lock", "bun.lockb", "bunfig.toml"];

const NODE_FEATURE = "ghcr.io/devcontainers/features/node:1";
const NODE_INDICATORS = ["package.json"];

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

export function buildAdditionalFeatures(
  worktreePath: string,
): Record<string, Record<string, unknown>> {
  const features: Record<string, Record<string, unknown>> = {
    [CLAUDE_CODE_FEATURE]: {},
    [CODEX_FEATURE]: {},
  };

  if (detectBunUsage(worktreePath)) {
    features[BUN_FEATURE] = {};
  }

  if (detectNodeUsage(worktreePath)) {
    features[NODE_FEATURE] = {};
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
  containerEnv: Record<string, string>;
  portBindings: Record<string, string>;
}): Promise<MergedConfigResult> {
  const { devcontainerConfig, worktreePath, containerEnv, portBindings } =
    options;

  const merged: Record<string, unknown> = {};

  // Start from existing config (minus fields we handle ourselves)
  if (devcontainerConfig) {
    Object.assign(merged, devcontainerConfig);
    // Remove fields we handle via our own mechanisms
    delete merged.forwardPorts;
    delete merged.remoteEnv;
  }

  // Set default image if no image/dockerFile/dockerComposeFile specified
  if (!merged.image && !merged.dockerFile && !merged.dockerComposeFile) {
    merged.image = "node:24";
  }

  // Merge containerEnv (CLAUDE_CONFIG_DIR points to mounted host config)
  const existingContainerEnv =
    (merged.containerEnv as Record<string, string>) ?? {};
  merged.containerEnv = {
    ...existingContainerEnv,
    ...containerEnv,
    CLAUDE_CONFIG_DIR: "/devenv-claude-config",
  };

  // Mount host Claude config directory into the container
  const existingMounts = (merged.mounts as string[]) ?? [];
  merged.mounts = [
    ...existingMounts,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: apparently this is valid
    "source=${localEnv:HOME}/.claude,target=/devenv-claude-config,type=bind",
  ];

  // Set appPort from our allocated port bindings
  merged.appPort = buildAppPort(portBindings);

  // Merge postCreateCommand
  merged.postCreateCommand = buildPostCreateCommand(
    devcontainerConfig?.postCreateCommand,
  );

  // Build additional features
  const additionalFeatures = buildAdditionalFeatures(worktreePath);

  // Write to temp directory with required filename
  // @devcontainers/cli requires config to be named devcontainer.json or .devcontainer.json
  const configDir = mkdtempSync(join(tmpdir(), "devenv-config-"));
  const configPath = join(configDir, "devcontainer.json");
  await Bun.write(configPath, JSON.stringify(merged, null, 2));

  return { configPath, additionalFeatures };
}
