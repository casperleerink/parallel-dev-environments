import { DEFAULT_CONTAINER_PORT, LOCALHOST_SUFFIX } from "@repo/shared";
import { type Dirent, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	".devenv",
	"worktrees",
]);

const ENV_FILE_PATTERN = /^\.env(\..+)?$/;

interface DiscoveredEnvFile {
	relativePath: string;
	content: string;
}

export async function discoverEnvFiles(
	dirPath: string,
): Promise<DiscoveredEnvFile[]> {
	const results: DiscoveredEnvFile[] = [];
	await walkDir(dirPath, dirPath, 0, results);
	return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walkDir(
	basePath: string,
	currentPath: string,
	depth: number,
	results: DiscoveredEnvFile[],
): Promise<void> {
	if (depth > 2) return;

	let entries: Dirent[];
	try {
		entries = readdirSync(currentPath, {
			withFileTypes: true,
		}) as Dirent[];
	} catch {
		return;
	}

	for (const entry of entries) {
		const name = entry.name as unknown as string;
		if (entry.isDirectory()) {
			if (!EXCLUDED_DIRS.has(name)) {
				await walkDir(basePath, join(currentPath, name), depth + 1, results);
			}
		} else if (entry.isFile() && ENV_FILE_PATTERN.test(name)) {
			const fullPath = join(currentPath, name);
			const relPath = relative(basePath, fullPath);
			const content = await Bun.file(fullPath).text();
			results.push({ relativePath: relPath, content });
		}
	}
}

export function formatRouteId(envName: string): string {
	return `devenv-${envName}`;
}

export function generateHostname(
	projectName: string,
	branch: string,
	port?: number,
): string {
	const portSuffix =
		port !== undefined && port !== DEFAULT_CONTAINER_PORT ? `-${port}` : "";
	return `${projectName}-${branch}${portSuffix}${LOCALHOST_SUFFIX}`;
}
