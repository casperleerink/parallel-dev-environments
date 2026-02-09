import { API_PORT } from "@repo/shared";
import { registerCommand } from "./index.js";
import { startApiServer } from "../api/server.js";

registerCommand({
	name: "dashboard",
	description: "Start the API server for the dashboard",
	async run() {
		const server = startApiServer();
		console.log(`API server running at http://localhost:${API_PORT}`);
		console.log("Press Ctrl+C to stop.");

		// Keep process alive
		await new Promise(() => {});
	},
});
