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

			// Resolve the remoteUser from stored devcontainer config, defaulting to "node".
			// docker exec defaults to root, but we need to run as the non-root user
			// so that tools like Claude Code --dangerously-skip-permissions work.
			let remoteUser = "node";
			if (environment.devcontainerConfig) {
				const parsed = JSON.parse(environment.devcontainerConfig) as {
					remoteUser?: string;
				};
				if (parsed.remoteUser) {
					remoteUser = parsed.remoteUser;
				}
			}

			// Resolve the remote user's home directory and PATH.
			// docker exec does not set HOME, which breaks PATH entries using $HOME
			// (e.g. claude-code installs to $HOME/.local/bin).
			// Additionally, devcontainer features may bake $HOME/.local/bin into PATH
			// with an empty HOME during build, resulting in "/.local/bin" instead of
			// the correct path. We fix this by prepending the resolved home-based path.
			const homeProc = Bun.spawn(
				[
					"docker",
					"exec",
					"--user",
					remoteUser,
					environment.containerId,
					"sh",
					"-c",
					"echo ~",
				],
				{ stdout: "pipe" },
			);
			const homeDir = (await new Response(homeProc.stdout).text()).trim();

			const pathProc = Bun.spawn(
				[
					"docker",
					"exec",
					"--user",
					remoteUser,
					environment.containerId,
					"sh",
					"-c",
					'echo "$PATH"',
				],
				{ stdout: "pipe" },
			);
			const containerPath = (await new Response(pathProc.stdout).text()).trim();

			// devcontainer CLI mounts workspace to /workspaces/<folder-name>
			const workDir = environment.worktreePath
				? `/workspaces/${basename(environment.worktreePath)}`
				: undefined;

			const execArgs = ["docker", "exec", "-it", "--user", remoteUser];
			if (homeDir) {
				execArgs.push("-e", `HOME=${homeDir}`);
				execArgs.push("-e", `PATH=${homeDir}/.local/bin:${containerPath}`);
			}
			if (workDir) {
				execArgs.push("-w", workDir);
			}
			execArgs.push(environment.containerId, "/bin/bash", "-l");

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
