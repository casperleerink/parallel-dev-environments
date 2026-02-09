import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	CONTAINER_LABEL_PREFIX,
	DEVENV_DIR,
	DEVENV_WORKTREES_DIR,
} from "@repo/shared";
import {
	createDatabase,
	getEnvFiles,
	getEnvironmentByName,
	getNextAvailableHostPort,
	insertEnvironment,
	insertPortMapping,
	updateEnvironmentContainer,
	updateEnvironmentStatus,
	upsertEnvFile,
} from "../db/database.js";
import type { DevcontainerConfig } from "../devcontainer/parser.js";
import {
	resolveEnvVars,
	resolveForwardPorts,
	resolveImage,
} from "../devcontainer/parser.js";
import {
	createContainer,
	pullImage,
	startContainer,
} from "../docker/client.js";
import { addRoute, ensureCaddyRunning } from "../tunnel/caddy.js";
import { formatRouteId, generateHostname } from "../utils/envfiles.js";
import { createWorktree } from "../utils/git.js";
import { registerCommand } from "./index.js";

function slugify(str: string): string {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

registerCommand({
	name: "branch",
	description:
		"Create a new environment from an existing one on a different branch",
	async run(args: string[]) {
		const envName = args[0];
		const newBranch = args[1];

		if (!envName || !newBranch) {
			throw new Error("Usage: devenv branch <env-name> <new-branch>");
		}

		const db = createDatabase();
		try {
			// Look up source environment
			const sourceEnv = getEnvironmentByName(db, envName);
			if (!sourceEnv) {
				throw new Error(`Environment not found: ${envName}`);
			}

			// Look up project by ID
			const projectRow = db
				.prepare("SELECT * FROM projects WHERE id = ?")
				.get(sourceEnv.projectId) as {
				id: number;
				name: string;
				repo_path: string;
			} | null;

			if (!projectRow) {
				throw new Error("Source project not found");
			}

			const projectName = projectRow.name;
			const repoPath = projectRow.repo_path;
			const newEnvName = `${projectName}-${slugify(newBranch)}`;

			console.log(
				`Creating environment ${newEnvName} from ${envName} on branch ${newBranch}`,
			);

			// Create worktree
			const worktreePath = join(
				repoPath,
				DEVENV_DIR,
				DEVENV_WORKTREES_DIR,
				newBranch,
			);
			if (!existsSync(worktreePath)) {
				console.log(`  Creating worktree for branch: ${newBranch}`);
				await createWorktree(repoPath, newBranch, worktreePath);
			}

			// Parse devcontainer config from source
			const devcontainerConfig: DevcontainerConfig | null =
				sourceEnv.devcontainerConfig
					? (JSON.parse(sourceEnv.devcontainerConfig) as DevcontainerConfig)
					: null;

			// Create environment record
			const newEnvironment = insertEnvironment(
				db,
				sourceEnv.projectId,
				newEnvName,
				newBranch,
				worktreePath,
				sourceEnv.devcontainerConfig ?? undefined,
			);

			// Copy env files from source
			const sourceEnvFiles = getEnvFiles(db, sourceEnv.id);
			for (const envFile of sourceEnvFiles) {
				upsertEnvFile(
					db,
					newEnvironment.id,
					envFile.relativePath,
					envFile.content,
				);
			}
			if (sourceEnvFiles.length > 0) {
				console.log(
					`  Copied ${sourceEnvFiles.length} env file(s) from source`,
				);
			}

			// Docker image
			const image = resolveImage(devcontainerConfig);
			console.log(`  Pulling image: ${image}`);
			await pullImage(image);

			// Port mappings with fresh host ports
			const forwardPorts = resolveForwardPorts(devcontainerConfig);
			const portBindings: Record<string, string> = {};
			const portMappings: Array<{
				containerPort: number;
				hostPort: number;
				hostname: string;
			}> = [];

			for (const containerPort of forwardPorts) {
				const hostPort = getNextAvailableHostPort(db);
				const hostname = generateHostname(
					projectName,
					newBranch,
					containerPort,
				);
				portBindings[String(containerPort)] = String(hostPort);
				insertPortMapping(
					db,
					newEnvironment.id,
					containerPort,
					hostPort,
					hostname,
				);
				portMappings.push({ containerPort, hostPort, hostname });
			}

			// Env vars
			const configEnvVars = resolveEnvVars(devcontainerConfig);
			const envVarList: string[] = [];
			for (const [key, value] of Object.entries(configEnvVars)) {
				envVarList.push(`${key}=${value}`);
			}
			for (const envFile of sourceEnvFiles) {
				for (const line of envFile.content.split("\n")) {
					const trimmed = line.trim();
					if (trimmed && !trimmed.startsWith("#")) {
						envVarList.push(trimmed);
					}
				}
			}

			// Create container
			console.log("  Creating container...");
			const containerId = await createContainer({
				name: newEnvName,
				image,
				workspaceDir: worktreePath,
				envVars: envVarList,
				labels: {
					[`${CONTAINER_LABEL_PREFIX}.project`]: projectName,
					[`${CONTAINER_LABEL_PREFIX}.environment`]: newEnvName,
				},
				portBindings,
			});

			updateEnvironmentContainer(db, newEnvironment.id, containerId);

			// Caddy routes
			console.log("  Configuring reverse proxy...");
			await ensureCaddyRunning();
			for (const pm of portMappings) {
				const routeId = formatRouteId(`${newEnvName}-${pm.containerPort}`);
				await addRoute(routeId, pm.hostname, pm.hostPort);
			}

			// Start container
			await startContainer(containerId);
			updateEnvironmentStatus(db, newEnvironment.id, "running");

			// Summary
			console.log("\nEnvironment created successfully!");
			console.log(`  Name:   ${newEnvName}`);
			console.log(`  Branch: ${newBranch}`);
			console.log(`  Status: running`);
			console.log("  URLs:");
			for (const pm of portMappings) {
				console.log(`    http://${pm.hostname} \u2192 :${pm.containerPort}`);
			}
		} finally {
			db.close();
		}
	},
});
