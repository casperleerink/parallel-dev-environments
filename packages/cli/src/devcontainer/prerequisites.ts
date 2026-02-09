import { which } from "bun";

export async function ensureDevcontainerCLI(): Promise<void> {
	const path = which("devcontainer");
	if (!path) {
		throw new Error(
			"devcontainer CLI not found. Install it with: npm install -g @devcontainers/cli",
		);
	}
}
