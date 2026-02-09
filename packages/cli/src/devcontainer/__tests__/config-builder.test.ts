import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	buildAdditionalFeatures,
	buildMergedConfig,
	detectBunUsage,
} from "../config-builder.js";

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

describe("buildAdditionalFeatures", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `devenv-features-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("always includes claude-code feature", () => {
		const features = buildAdditionalFeatures(tempDir);
		expect(
			"ghcr.io/anthropics/devcontainer-features/claude-code:1" in features,
		).toBe(true);
	});

	it("includes bun feature when bun.lock present", () => {
		writeFileSync(join(tempDir, "bun.lock"), "");
		const features = buildAdditionalFeatures(tempDir);
		expect(
			"ghcr.io/shyim/devcontainers-features/bun:0" in features,
		).toBe(true);
	});

	it("does not include bun feature when no bun indicators", () => {
		const features = buildAdditionalFeatures(tempDir);
		expect(
			"ghcr.io/shyim/devcontainers-features/bun:0" in features,
		).toBe(false);
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
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.image).toBe("python:3.12");

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("merges containerEnv from config and provided env", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				containerEnv: { EXISTING: "value" },
			},
			worktreePath: tempDir,
			containerEnv: { NEW_VAR: "new_value" },
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.containerEnv).toEqual({
			EXISTING: "value",
			NEW_VAR: "new_value",
			CLAUDE_CONFIG_DIR: "/devenv-claude-config",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("generates appPort from port bindings", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: { "3000": "49200", "5432": "49201" },
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.appPort).toContain("49200:3000");
		expect(config.appPort).toContain("49201:5432");

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("merges postCreateCommand with codex install", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				postCreateCommand: "npm install",
			},
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			"devenv-codex": "npm install -g @openai/codex",
			project: "npm install",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("handles array postCreateCommand", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				postCreateCommand: ["npm", "install", "--frozen-lockfile"],
			},
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			"devenv-codex": "npm install -g @openai/codex",
			project: "npm install --frozen-lockfile",
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
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			"devenv-codex": "npm install -g @openai/codex",
			setup: "npm install",
			build: "npm run build",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("adds codex install when no postCreateCommand exists", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.postCreateCommand).toEqual({
			"devenv-codex": "npm install -g @openai/codex",
		});

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("sets CLAUDE_CONFIG_DIR in containerEnv", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.containerEnv.CLAUDE_CONFIG_DIR).toBe(
			"/devenv-claude-config",
		);

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("includes mount for host Claude config directory", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: null,
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.mounts).toContain(
			"source=${localEnv:HOME}/.claude,target=/devenv-claude-config,type=bind",
		);

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("preserves existing mounts from devcontainer config", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				mounts: [
					"source=${localEnv:HOME}/.ssh,target=/root/.ssh,type=bind,readonly",
				],
			},
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.mounts).toContain(
			"source=${localEnv:HOME}/.ssh,target=/root/.ssh,type=bind,readonly",
		);
		expect(config.mounts).toContain(
			"source=${localEnv:HOME}/.claude,target=/devenv-claude-config,type=bind",
		);

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});

	it("removes forwardPorts and remoteEnv from config", async () => {
		const result = await buildMergedConfig({
			devcontainerConfig: {
				forwardPorts: [3000],
				remoteEnv: { PATH: "/usr/bin" },
				image: "node:24",
			},
			worktreePath: tempDir,
			containerEnv: {},
			portBindings: {},
		});

		const config = JSON.parse(await Bun.file(result.configPath).text());
		expect(config.forwardPorts).toBeUndefined();
		expect(config.remoteEnv).toBeUndefined();

		rmSync(dirname(result.configPath), { recursive: true, force: true });
	});
});
