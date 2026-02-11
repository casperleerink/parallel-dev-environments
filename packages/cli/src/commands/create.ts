import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DEVENV_DIR, DEVENV_WORKTREES_DIR } from "@repo/shared";
import {
	createDatabase,
	deletePortMappings,
	getEnvironmentByName,
	getNextAvailableHostPort,
	getProjectByName,
	insertEnvironment,
	insertPortMapping,
	insertProject,
	updateEnvironmentContainer,
	updateEnvironmentStatus,
	upsertEnvFile,
} from "../db/database.js";
import { buildMergedConfig } from "../devcontainer/config-builder.js";
import {
	detectPostgresFeature,
	findDevcontainerConfig,
	resolveEnvVars,
	resolveForwardPorts,
} from "../devcontainer/parser.js";
import { ensureDevcontainerCLI } from "../devcontainer/prerequisites.js";
import { devcontainerUp } from "../devcontainer/runner.js";
import { DockerError, inspectContainer } from "../docker/client.js";
import { addRoute, ensureCaddyRunning } from "../tunnel/caddy.js";
import {
	discoverEnvFiles,
	formatRouteId,
	generateHostname,
} from "../utils/envfiles.js";
import { createWorktree } from "../utils/git.js";
import { registerCommand } from "./index.js";

function slugify(str: string): string {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function parseArgs(args: string[]): { repo: string; branch: string } {
	let repo: string | undefined;
	let branch: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--repo" && i + 1 < args.length) {
			repo = args[++i];
		} else if (arg === "--branch" && i + 1 < args.length) {
			branch = args[++i];
		}
	}

	if (!repo) {
		throw new Error("--repo <path> is required");
	}
	if (!branch) {
		throw new Error("--branch <name> is required");
	}

	return { repo, branch };
}

function elapsed(start: number): string {
	return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

registerCommand({
	name: "create",
	description: "Create a new development environment",
	async run(args: string[]) {
		const { repo, branch } = parseArgs(args);
		const repoPath = resolve(repo);
		const totalStart = performance.now();

		// Validate prerequisites
		await ensureDevcontainerCLI();

		// Validate repo
		if (!existsSync(join(repoPath, ".git"))) {
			throw new Error(`Not a git repository: ${repoPath}`);
		}
		const projectName = slugify(basename(repoPath));
		const envName = `${projectName}-${slugify(branch)}`;

		console.log(`Creating environment: ${envName}`);

		// Ensure .devenv directory
		const devenvDir = join(repoPath, DEVENV_DIR);
		if (!existsSync(devenvDir)) {
			mkdirSync(devenvDir, { recursive: true });
		}

		// Database
		const db = createDatabase();
		try {
			// Project
			let project = getProjectByName(db, projectName);
			if (!project) {
				project = insertProject(db, projectName, repoPath);
				console.log(`  Project created: ${projectName}`);
			}

			// Worktree
			const worktreePath = join(
				repoPath,
				DEVENV_DIR,
				DEVENV_WORKTREES_DIR,
				branch,
			);
			if (!existsSync(worktreePath)) {
				console.log(`  Creating worktree for branch: ${branch}`);
				const wtStart = performance.now();
				await createWorktree(repoPath, branch, worktreePath);
				console.log(`  Worktree created (${elapsed(wtStart)})`);
			}

			// Environment
			const devcontainerConfig = await findDevcontainerConfig(repoPath);
			let environment = getEnvironmentByName(db, envName);
			let removeExistingContainer = false;
			if (environment) {
				if (environment.status === "running") {
					// Verify the container is actually running in Docker
					let containerActuallyRunning = false;
					if (environment.containerId) {
						try {
							const info = await inspectContainer(environment.containerId);
							containerActuallyRunning = info.State.Running;
						} catch (e) {
							if (e instanceof DockerError && e.statusCode === 404) {
								// Container no longer exists
							} else {
								throw e;
							}
						}
					}
					if (containerActuallyRunning) {
						throw new Error(
							`Environment "${envName}" already exists and is running. Use 'devenv destroy' first.`,
						);
					}
					// DB status is stale — container is gone or stopped
					updateEnvironmentStatus(db, environment.id, "stopped");
				}
				removeExistingContainer = true;
				console.log(`  Resuming setup for existing environment: ${envName}`);
			} else {
				environment = insertEnvironment(
					db,
					project.id,
					envName,
					branch,
					worktreePath,
					devcontainerConfig ? JSON.stringify(devcontainerConfig) : undefined,
				);
			}

			// Env files — discover from original repo and copy to worktree
			const envFiles = await discoverEnvFiles(repoPath);
			for (const envFile of envFiles) {
				upsertEnvFile(
					db,
					environment.id,
					envFile.relativePath,
					envFile.content,
				);
				// Copy env file to worktree so it exists in the container workspace
				const targetPath = join(worktreePath, envFile.relativePath);
				mkdirSync(dirname(targetPath), { recursive: true });
				writeFileSync(targetPath, envFile.content);
			}
			if (envFiles.length > 0) {
				console.log(`  Copied ${envFiles.length} env file(s) to worktree`);
			}

			// Clear stale port mappings from previous failed attempt
			deletePortMappings(db, environment.id);

			// Port mappings
			const forwardPorts = resolveForwardPorts(devcontainerConfig);
			const portBindings: Record<string, string> = {};
			const portMappings: Array<{
				containerPort: number;
				hostPort: number;
				hostname: string;
			}> = [];

			for (const containerPort of forwardPorts) {
				const hostPort = getNextAvailableHostPort(db);
				const hostname = generateHostname(projectName, branch, containerPort);
				portBindings[String(containerPort)] = String(hostPort);
				insertPortMapping(
					db,
					environment.id,
					containerPort,
					hostPort,
					hostname,
				);
				portMappings.push({ containerPort, hostPort, hostname });
			}

			// Build container env vars from devcontainer config only
			// (env files are copied as files to the worktree, not flattened into env vars)
			const containerEnv = resolveEnvVars(devcontainerConfig);

			// Build merged devcontainer config and run devcontainer up
			console.log("  Building devcontainer configuration...");
			const { configPath, additionalFeatures } = await buildMergedConfig({
				devcontainerConfig,
				worktreePath,
				repoPath,
				containerEnv,
				portBindings,
			});

			console.log("  Starting devcontainer...");
			const dcStart = performance.now();
			const { containerId } = await devcontainerUp({
				worktreePath,
				configPath,
				projectName,
				envName,
				additionalFeatures,
				removeExistingContainer,
			});
			console.log(`  Devcontainer started (${elapsed(dcStart)})`);

			updateEnvironmentContainer(db, environment.id, containerId);
			updateEnvironmentStatus(db, environment.id, "running");

			// Caddy routes
			console.log("  Configuring reverse proxy...");
			const caddyStart = performance.now();
			await ensureCaddyRunning();
			for (const pm of portMappings) {
				const routeId = formatRouteId(`${envName}-${pm.containerPort}`);
				await addRoute(routeId, pm.hostname, pm.hostPort);
			}
			console.log(`  Reverse proxy configured (${elapsed(caddyStart)})`);

			// Summary
			console.log(
				`\nEnvironment created successfully! (${elapsed(totalStart)} total)`,
			);
			console.log(`  Name:   ${envName}`);
			console.log(`  Branch: ${branch}`);
			console.log(`  Status: running`);
			console.log("  URLs:");
			for (const pm of portMappings) {
				console.log(`    http://${pm.hostname} → :${pm.containerPort}`);
			}
			if (detectPostgresFeature(devcontainerConfig)) {
				console.log("  PostgreSQL:");
				console.log(
					"    postgres://postgres@localhost:5432/postgres (inside container)",
				);
				const pgMapping = portMappings.find((pm) => pm.containerPort === 5432);
				if (pgMapping) {
					console.log(
						`    postgres://postgres@localhost:${pgMapping.hostPort}/postgres (from host)`,
					);
				}
			}
		} finally {
			db.close();
		}
	},
});
