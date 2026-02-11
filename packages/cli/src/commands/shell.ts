import { basename } from "node:path";
import { createDatabase, getEnvironmentByName } from "../db/database.js";
import { registerCommand } from "./index.js";

registerCommand({
	name: "shell",
	description: "Open an interactive shell in a running environment",
	async run(args: string[]) {
		const envName = args[0];
		if (!envName) {
			throw new Error("Usage: devenv shell <env-name>");
		}

		const db = createDatabase();
		try {
			const environment = getEnvironmentByName(db, envName);
			if (!environment) {
				throw new Error(`Environment not found: ${envName}`);
			}

			if (environment.status !== "running") {
				throw new Error(
					`Environment is not running (status: ${environment.status}). Start it first with: devenv start ${envName}`,
				);
			}

			if (!environment.containerId) {
				throw new Error(`No container associated with environment: ${envName}`);
			}

			console.log(`Opening shell in ${envName}...`);

			// Use devcontainer exec instead of docker exec to automatically apply remoteEnv
			// (including CLAUDE_CONFIG_DIR and CLAUDE_CODE_OAUTH_TOKEN from config-builder.ts).
			// This ensures all environment variables defined in remoteEnv are available without
			// manual synchronization between config-builder and this command.
			//
			// devcontainer CLI mounts workspace to /workspaces/<folder-name>
			const workDir = environment.worktreePath
				? `/workspaces/${basename(environment.worktreePath)}`
				: "/workspaces";

			// devcontainer exec doesn't yet support -w/--workdir flag (https://github.com/devcontainers/cli/issues/703)
			// so we use a wrapper command to cd to the workspace and then exec bash.
			const execArgs = [
				"devcontainer",
				"exec",
				"--container-id",
				environment.containerId,
				"sh",
				"-c",
				`cd ${workDir} && exec /bin/bash -l`,
			];

			const proc = Bun.spawn(execArgs, {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});

			await proc.exited;
		} finally {
			db.close();
		}
	},
});
