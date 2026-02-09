#!/usr/bin/env bun

import { getAllCommands, getCommand } from "./commands/index.js";

// Commands will be imported here as they are built:
import "./commands/create.js";
import "./commands/start.js";
import "./commands/stop.js";
import "./commands/list.js";
import "./commands/shell.js";
import "./commands/branch.js";
import "./commands/env.js";
import "./commands/dashboard.js";

function printHelp(): void {
	console.log("devenv — Docker-based development environments\n");
	console.log("Usage: devenv <command> [options]\n");
	console.log("Commands:");

	const commands = getAllCommands();
	if (commands.length === 0) {
		console.log("  (no commands registered yet)");
	} else {
		for (const cmd of commands) {
			console.log(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
		}
	}

	console.log("\nOptions:");
	console.log("  --help     Show this help message");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	const commandName = args[0]!;
	const command = getCommand(commandName);

	if (!command) {
		console.error(`Unknown command: ${commandName}`);
		console.error('Run "devenv --help" for usage information.');
		process.exit(1);
	}

	await command.run(args.slice(1));
}

main().catch((error: unknown) => {
	console.error("Error:", error instanceof Error ? error.message : error);
	process.exit(1);
});
