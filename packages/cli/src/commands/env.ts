import { registerCommand } from "./index.js";
import {
	createDatabase,
	getEnvironmentByName,
	getEnvFiles,
	upsertEnvFile,
} from "../db/database.js";

registerCommand({
	name: "env",
	description: "Manage environment variables",
	async run(args: string[]) {
		const subcommand = args[0];

		if (subcommand === "list") {
			await envList(args.slice(1));
		} else if (subcommand === "set") {
			await envSet(args.slice(1));
		} else {
			console.error("Usage:");
			console.error("  devenv env list <env-name>");
			console.error("  devenv env set <env-name> <KEY=VALUE>");
			process.exit(1);
		}
	},
});

async function envList(args: string[]): Promise<void> {
	const envName = args[0];
	if (!envName) {
		throw new Error("Usage: devenv env list <env-name>");
	}

	const db = createDatabase();
	try {
		const environment = getEnvironmentByName(db, envName);
		if (!environment) {
			throw new Error(`Environment not found: ${envName}`);
		}

		const envFiles = getEnvFiles(db, environment.id);

		if (envFiles.length === 0) {
			console.log(`No env files stored for environment: ${envName}`);
			return;
		}

		for (const file of envFiles) {
			console.log(`\n--- ${file.relativePath} ---`);
			console.log(file.content);
		}
	} finally {
		db.close();
	}
}

async function envSet(args: string[]): Promise<void> {
	const envName = args[0];
	const keyValue = args[1];

	if (!envName || !keyValue) {
		throw new Error("Usage: devenv env set <env-name> <KEY=VALUE>");
	}

	const equalsIndex = keyValue.indexOf("=");
	if (equalsIndex === -1) {
		throw new Error(
			`Invalid format: "${keyValue}". Expected KEY=VALUE.`,
		);
	}

	const key = keyValue.substring(0, equalsIndex);
	const value = keyValue.substring(equalsIndex + 1);

	const db = createDatabase();
	try {
		const environment = getEnvironmentByName(db, envName);
		if (!environment) {
			throw new Error(`Environment not found: ${envName}`);
		}

		// Get existing .env file content or start fresh
		const envFiles = getEnvFiles(db, environment.id);
		const envFile = envFiles.find((f) => f.relativePath === ".env");
		let content = envFile?.content ?? "";

		// Check if key already exists and update it, otherwise append
		const lines = content.split("\n");
		let found = false;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (line.startsWith(`${key}=`)) {
				lines[i] = `${key}=${value}`;
				found = true;
				break;
			}
		}

		if (!found) {
			// Append, ensuring we don't add extra blank lines
			if (content.length > 0 && !content.endsWith("\n")) {
				content += "\n";
			}
			content += `${key}=${value}\n`;
		} else {
			content = lines.join("\n");
		}

		upsertEnvFile(db, environment.id, ".env", content);
		console.log(`Set ${key}=${value} in ${envName}`);
	} finally {
		db.close();
	}
}
