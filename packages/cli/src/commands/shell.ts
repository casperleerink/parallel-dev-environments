import { registerCommand } from "./index.js";
import { createDatabase, getEnvironmentByName } from "../db/database.js";

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
				throw new Error(
					`No container associated with environment: ${envName}`,
				);
			}

			console.log(`Opening shell in ${envName}...`);

			// Use Bun.spawn with docker exec for proper TTY passthrough
			// The Docker Engine HTTP API doesn't support bidirectional streaming
			// well with fetch, so we shell out to docker exec instead
			const proc = Bun.spawn(
				[
					"docker",
					"exec",
					"-it",
					environment.containerId,
					"/bin/sh",
				],
				{
					stdin: "inherit",
					stdout: "inherit",
					stderr: "inherit",
				},
			);

			await proc.exited;
		} finally {
			db.close();
		}
	},
});
