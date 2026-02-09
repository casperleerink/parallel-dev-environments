interface Command {
	name: string;
	description: string;
	run: (args: string[]) => Promise<void>;
}

const commands = new Map<string, Command>();

export function registerCommand(command: Command): void {
	commands.set(command.name, command);
}

export function getCommand(name: string): Command | undefined {
	return commands.get(name);
}

export function getAllCommands(): Command[] {
	return Array.from(commands.values());
}
