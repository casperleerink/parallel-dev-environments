import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { CONTAINER_LABEL_PREFIX } from "@repo/shared";

interface DevcontainerUpResult {
	containerId: string;
}

interface DevcontainerUpOutput {
	outcome: string;
	containerId: string;
}

export async function devcontainerUp(options: {
	worktreePath: string;
	configPath: string;
	projectName: string;
	envName: string;
	additionalFeatures: Record<string, Record<string, unknown>>;
	removeExistingContainer: boolean;
}): Promise<DevcontainerUpResult> {
	const {
		worktreePath,
		configPath,
		projectName,
		envName,
		additionalFeatures,
		removeExistingContainer,
	} = options;

	const args = [
		"up",
		"--workspace-folder",
		worktreePath,
		"--config",
		configPath,
		"--id-label",
		`${CONTAINER_LABEL_PREFIX}.managed=true`,
		"--id-label",
		`${CONTAINER_LABEL_PREFIX}.project=${projectName}`,
		"--id-label",
		`${CONTAINER_LABEL_PREFIX}.environment=${envName}`,
	];

	if (Object.keys(additionalFeatures).length > 0) {
		args.push("--additional-features", JSON.stringify(additionalFeatures));
	}

	if (removeExistingContainer) {
		args.push("--remove-existing-container");
	}

	const proc = Bun.spawn(["devcontainer", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);

	const exitCode = await proc.exited;

	// Clean up temp config directory (configPath is <tmpdir>/devenv-config-XXXXX/devcontainer.json)
	try {
		rmSync(dirname(configPath), { recursive: true });
	} catch {
		// Ignore cleanup errors
	}

	if (exitCode !== 0) {
		throw new Error(
			`devcontainer up failed (exit code ${exitCode}):\n${stderr || stdout}`,
		);
	}

	// Parse JSON output from stdout
	// devcontainer up prints JSON to stdout with the container ID
	let output: DevcontainerUpOutput;
	try {
		output = JSON.parse(stdout) as DevcontainerUpOutput;
	} catch {
		throw new Error(
			`Failed to parse devcontainer up output:\n${stdout}\n${stderr}`,
		);
	}

	if (!output.containerId) {
		throw new Error(
			`devcontainer up did not return a container ID:\n${stdout}`,
		);
	}

	return { containerId: output.containerId };
}
