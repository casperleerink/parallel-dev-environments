import { registerCommand } from "./index.js";
import { createDatabase, getProjectsWithEnvironments, getPortMappings } from "../db/database.js";

registerCommand({
	name: "list",
	description: "List all development environments",
	async run() {
		const db = createDatabase();
		try {
			const projects = getProjectsWithEnvironments(db);

			if (projects.length === 0) {
				console.log("No environments found.");
				console.log(
					'Run "devenv create --repo <path>" to create one.',
				);
				return;
			}

			for (const project of projects) {
				console.log(`\n${project.name} (${project.repoPath})`);

				if (project.environments.length === 0) {
					console.log("  No environments");
					continue;
				}

				for (const env of project.environments) {
					const status =
						env.status === "running" ? "\x1b[32m●\x1b[0m" : "\x1b[90m○\x1b[0m";
					const statusText =
						env.status === "running"
							? "\x1b[32mrunning\x1b[0m"
							: env.status;

					console.log(
						`  ${status} ${env.name.padEnd(30)} ${env.branch.padEnd(20)} ${statusText}`,
					);

					const portMappings = getPortMappings(db, env.id);
					for (const pm of portMappings) {
						console.log(
							`      http://${pm.hostname} \u2192 :${pm.containerPort}`,
						);
					}
				}
			}
		} finally {
			db.close();
		}
	},
});
