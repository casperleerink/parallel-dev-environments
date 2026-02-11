import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	buildAdditionalFeatures,
	buildMergedConfig,
	detectBunUsage,
	detectNodeUsage,
} from "../config-builder.js";

const FAKE_REPO_PATH = "/tmp/fake-repo";

describe("detectBunUsage", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `devenv-config-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("detects bun.lock", () => {
		writeFileSync(join(tempDir, "bun.lock"), "");
		expect(detectBunUsage(tempDir)).toBe(true);
	});

	it("detects bun.lockb", () => {
		writeFileSync(join(tempDir, "bun.lockb"), "");
		expect(detectBunUsage(tempDir)).toBe(true);
	});

	it("detects bunfig.toml", () => {
		writeFileSync(join(tempDir, "bunfig.toml"), "");
		expect(detectBunUsage(tempDir)).toBe(true);
	});

	it("returns false when no bun indicators", () => {
		writeFileSync(join(tempDir, "package.json"), "{}");
		expect(detectBunUsage(tempDir)).toBe(false);
	});
});

describe("detectNodeUsage", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `devenv-config-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("detects package.json", () => {
		writeFileSync(join(tempDir, "package.json"), "{}");
		expect(detectNodeUsage(tempDir)).toBe(true);
	});

	it("returns false when no node indicators", () => {
		writeFileSync(join(tempDir, "README.md"), "");
		expect(detectNodeUsage(tempDir)).toBe(false);
	});
});

describe("buildAdditionalFeatures", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `devenv-features-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty features when no indicators present", () => {
		const features = buildAdditionalFeatures(tempDir);
		expect(Object.keys(features)).toHaveLength(0);
	});

	it("includes bun feature when bun.lock present", () => {
		writeFileSync(join(tempDir, "bun.lock"), "");
		const features = buildAdditionalFeatures(tempDir);
		expect("ghcr.io/shyim/devcontainers-features/bun:0" in features).toBe(true);
	});

	it("does not include bun feature when no bun indicators", () => {
		const features = buildAdditionalFeatures(tempDir);
		expect("ghcr.io/shyim/devcontainers-features/bun:0" in features).toBe(
			false,
		);
	});

	it("includes node feature when package.json present", () => {
		writeFileSync(join(tempDir, "package.json"), "{}");
		const features = buildAdditionalFeatures(tempDir);
		expect("ghcr.io/devcontainers/features/node:1" in features).toBe(true);
	});

	it("does not include node feature when no node indicators", () => {
		const features = buildAdditionalFeatures(tempDir);
		expect("ghcr.io/devcontainers/features/node:1" in features).toBe(false);
	});
});

describe("buildMergedConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `devenv-merged-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("writes config to file named devcontainer.json", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		expect(result.configPath).toMatch(/\/devcontainer\.json$/);

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("uses node:24 as default image when no config", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.image).toBe("node:24");

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("preserves existing image from config", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: { image: "python:3.12" },
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.image).toBe("python:3.12");

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("puts injected env vars into remoteEnv, preserves project containerEnv", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				containerEnv: { EXISTING: "value" },
			},
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: { NEW_VAR: "new_value" },
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		// Project's containerEnv is preserved unchanged (stable for Docker layer caching)
		expect(config.containerEnv).toEqual({ EXISTING: "value" });
		// Injected env vars go to remoteEnv (applied at runtime)
		expect(config.remoteEnv).toEqual({
			NEW_VAR: "new_value",
			CLAUDE_CONFIG_DIR: "/devenv-claude-config",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("generates appPort from port bindings", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: { "3000": "49200", "5432": "49201" },
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.appPort).toContain("49200:3000");
		expect(config.appPort).toContain("49201:5432");

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("merges string postCreateCommand", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				postCreateCommand: "npm install",
			},
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			project: "npm install",
			"install-ai-tools":
				"npm install -g @anthropic-ai/claude-code @openai/codex",
			"fix-git-mount-permissions":
				"sudo chown $(whoami) /tmp/fake-repo 2>/dev/null || true",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("handles array postCreateCommand", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				postCreateCommand: ["npm", "install", "--frozen-lockfile"],
			},
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			project: "npm install --frozen-lockfile",
			"install-ai-tools":
				"npm install -g @anthropic-ai/claude-code @openai/codex",
			"fix-git-mount-permissions":
				"sudo chown $(whoami) /tmp/fake-repo 2>/dev/null || true",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("handles object postCreateCommand", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				postCreateCommand: {
					setup: "npm install",
					build: "npm run build",
				} as unknown as Record<string, string>,
			},
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			setup: "npm install",
			build: "npm run build",
			"install-ai-tools":
				"npm install -g @anthropic-ai/claude-code @openai/codex",
			"fix-git-mount-permissions":
				"sudo chown $(whoami) /tmp/fake-repo 2>/dev/null || true",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("includes ai tools in postCreateCommand when no existing command", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			"install-ai-tools":
				"npm install -g @anthropic-ai/claude-code @openai/codex",
			"fix-git-mount-permissions":
				"sudo chown $(whoami) /tmp/fake-repo 2>/dev/null || true",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("sets CLAUDE_CONFIG_DIR in remoteEnv", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.remoteEnv.CLAUDE_CONFIG_DIR).toBe("/devenv-claude-config");

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("includes mount for host Claude config directory", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.mounts).toContain(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: devcontainer syntax
			"source=${localEnv:HOME}/.claude,target=/devenv-claude-config,type=bind",
		);

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("preserves existing mounts from devcontainer config", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				mounts: [
					// biome-ignore lint/suspicious/noTemplateCurlyInString: devcontainer syntax
					"source=${localEnv:HOME}/.ssh,target=/root/.ssh,type=bind,readonly",
				],
			},
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.mounts).toContain(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: devcontainer syntax
			"source=${localEnv:HOME}/.ssh,target=/root/.ssh,type=bind,readonly",
		);
		expect(config.mounts).toContain(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: devcontainer syntax
			"source=${localEnv:HOME}/.claude,target=/devenv-claude-config,type=bind",
		);

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("removes forwardPorts from config", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				forwardPorts: [3000],
				image: "node:24",
			},
			worktreePath: tempDir,
			repoPath: FAKE_REPO_PATH,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.forwardPorts).toBeUndefined();

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});
});
