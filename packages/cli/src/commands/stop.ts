import { registerCommand } from "./index.js";
import {
	createDatabase,
	getEnvironmentByName,
	getPortMappings,
	updateEnvironmentStatus,
} from "../db/database.js";
import { stopContainer } from "../docker/client.js";
import { removeRoute } from "../tunnel/caddy.js";
import { formatRouteId } from "../utils/envfiles.js";

registerCommand({
	name: "stop",
	description: "Stop a development environment",
	async run(args: string[]) {
		const envName = args[0];
		if (!envName) {
			throw new Error("Usage: devenv stop <env-name>");
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

			console.log(`Stopping environment: ${envName}`);

			await stopContainer(environment.containerId);
			updateEnvironmentStatus(db, environment.id, "stopped");

			// Remove Caddy routes
			const portMappings = getPortMappings(db, environment.id);
			for (const pm of portMappings) {
				const routeId = formatRouteId(`${envName}-${pm.containerPort}`);
				await removeRoute(routeId);
			}

			console.log(`Environment stopped: ${envName}`);
		} finally {
			db.close();
		}
	},
});
