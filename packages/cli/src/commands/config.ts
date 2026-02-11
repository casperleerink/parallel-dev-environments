import {
	createDatabase,
	deleteSetting,
	getAllSettings,
	getSetting,
	setSetting,
} from "../db/database.js";
import { registerCommand } from "./index.js";

registerCommand({
	name: "config",
	description: "Manage global settings (set, get, delete, list)",
	async run(args: string[]) {
		const subcommand = args[0];

		if (!subcommand || subcommand === "--help" || subcommand === "-h") {
			console.log("Usage: devenv config <subcommand> [args]\n");
			console.log("Subcommands:");
			console.log("  set <key> <value>   Store a setting");
			console.log("  get <key>           Retrieve a setting");
			console.log("  delete <key>        Remove a setting");
			console.log("  list                Show all settings");
			return;
		}

		const db = createDatabase();
		try {
			switch (subcommand) {
				case "set": {
					const key = args[1];
					const value = args[2];
					if (!key || !value) {
						throw new Error("Usage: devenv config set <key> <value>");
					}
					setSetting(db, key, value);
					console.log(`Set ${key}`);
					break;
				}
				case "get": {
					const key = args[1];
					if (!key) {
						throw new Error("Usage: devenv config get <key>");
					}
					const value = getSetting(db, key);
					if (value === null) {
						console.log(`(not set)`);
					} else {
						console.log(value);
					}
					break;
				}
				case "delete": {
					const key = args[1];
					if (!key) {
						throw new Error("Usage: devenv config delete <key>");
					}
					const deleted = deleteSetting(db, key);
					if (deleted) {
						console.log(`Deleted ${key}`);
					} else {
						console.log(`Setting "${key}" not found`);
					}
					break;
				}
				case "list": {
					const settings = getAllSettings(db);
					if (settings.length === 0) {
						console.log("No settings configured");
					} else {
						for (const { key, value } of settings) {
							console.log(`${key} = ${value}`);
						}
					}
					break;
				}
				default:
					throw new Error(
						`Unknown subcommand: ${subcommand}. Run 'devenv config --help' for usage.`,
					);
			}
		} finally {
			db.close();
		}
	},
});
