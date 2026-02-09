import {
	createDatabase,
	getEnvironmentByName,
	getPortMappings,
	updateEnvironmentStatus,
} from "../db/database.js";
import { startContainer } from "../docker/client.js";
import { addRoute, ensureCaddyRunning } from "../tunnel/caddy.js";
import { formatRouteId } from "../utils/envfiles.js";
import { registerCommand } from "./index.js";

registerCommand({
	name: "start",
	description: "Start a development environment",
	async run(args: string[]) {
		const envName = args[0];
		if (!envName) {
			throw new Error("Usage: devenv start <env-name>");
		}

		const db = createDatabase();
		try {
			const environment = getEnvironmentByName(db, envName);
			if (!environment) {
				throw new Error(`Environment not found: ${envName}`);
			}

			if (!environment.containerId) {
				throw new Error(`No container associated with environment: ${envName}`);
			}

			console.log(`Starting environment: ${envName}`);

			await startContainer(environment.containerId);
			updateEnvironmentStatus(db, environment.id, "running");

			// Ensure Caddy is running and re-register routes
			await ensureCaddyRunning();
			const portMappings = getPortMappings(db, environment.id);
			for (const pm of portMappings) {
				const routeId = formatRouteId(`${envName}-${pm.containerPort}`);
				await addRoute(routeId, pm.hostname, pm.hostPort);
			}

			console.log(`Environment started: ${envName}`);
			if (portMappings.length > 0) {
				console.log("  URLs:");
				for (const pm of portMappings) {
					console.log(`    http://${pm.hostname} → :${pm.containerPort}`);
				}
			}
		} finally {
			db.close();
		}
	},
});
