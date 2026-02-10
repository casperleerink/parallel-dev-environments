import {
	createDatabase,
	deleteEnvFiles,
	deleteEnvironment,
	deletePortMappings,
	getEnvironmentByName,
	getPortMappings,
} from "../db/database.js";
import { removeContainer } from "../docker/client.js";
import { removeRoute } from "../tunnel/caddy.js";
import { formatRouteId } from "../utils/envfiles.js";
import { registerCommand } from "./index.js";

registerCommand({
	name: "remove",
	description: "Remove a development environment and its container",
	async run(args: string[]) {
		const envName = args[0];
		if (!envName) {
			throw new Error("Usage: devenv remove <env-name>");
		}

		const db = createDatabase();
		try {
			const environment = getEnvironmentByName(db, envName);
			if (!environment) {
				throw new Error(`Environment not found: ${envName}`);
			}

			console.log(`Removing environment: ${envName}`);

			// Remove Caddy routes
			const portMappings = getPortMappings(db, environment.id);
			for (const pm of portMappings) {
				const routeId = formatRouteId(`${envName}-${pm.containerPort}`);
				await removeRoute(routeId);
			}

			// Remove Docker container (force=true handles running containers)
			if (environment.containerId) {
				await removeContainer(environment.containerId);
			}

			// Clean up DB records (order matters due to foreign keys)
			deletePortMappings(db, environment.id);
			deleteEnvFiles(db, environment.id);
			deleteEnvironment(db, environment.id);

			console.log(`Environment removed: ${envName}`);
		} finally {
			db.close();
		}
	},
});
