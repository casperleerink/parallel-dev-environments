import { API_PORT } from "@repo/shared";
import { startApiServer } from "../api/server.js";
import { registerCommand } from "./index.js";

registerCommand({
	name: "dashboard",
	description: "Start the API server for the dashboard",
	async run() {
		const _server = startApiServer();
		console.log(`API server running at http://localhost:${API_PORT}`);
		console.log("Press Ctrl+C to stop.");

		// Keep process alive
		await new Promise(() => {});
	},
});
