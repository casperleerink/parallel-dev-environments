import { basename } from "node:path";
import { createDatabase, getEnvironmentByName } from "../db/database.js";
import { registerCommand } from "./index.js";

function hexEncode(str: string): string {
	return Buffer.from(str, "utf-8").toString("hex");
}

registerCommand({
	name: "open",
	description: "Open an environment in VS Code or Cursor",
	async run(args: string[]) {
		const useCursor = args.includes("--cursor");
		const filteredArgs = args.filter((a) => a !== "--cursor");
		const envName = filteredArgs[0];

		if (!envName) {
			throw new Error("Usage: devenv open <env-name> [--cursor]");
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

			const workDir = environment.worktreePath
				? `/workspaces/${basename(environment.worktreePath)}`
				: "/workspaces";

			const encodedId = hexEncode(environment.containerId);
			const folderUri = `vscode-remote://attached-container+${encodedId}${workDir}`;

			const editor = useCursor ? "cursor" : "code";
			console.log(
				`Opening ${envName} in ${useCursor ? "Cursor" : "VS Code"}...`,
			);

			const proc = Bun.spawn([editor, "--folder-uri", folderUri], {
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
