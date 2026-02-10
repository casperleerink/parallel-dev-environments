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

			// devcontainer CLI mounts workspace to /workspaces/<folder-name>
			const workDir = environment.worktreePath
				? `/workspaces/${basename(environment.worktreePath)}`
				: undefined;

			const execArgs = ["docker", "exec", "-it"];
			if (workDir) {
				execArgs.push("-w", workDir);
			}
			execArgs.push(environment.containerId, "/bin/sh");

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
