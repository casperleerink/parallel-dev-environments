import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findDevcontainerConfig,
	resolveEnvVars,
	resolveForwardPorts,
	resolveImage,
	resolvePostCreateCommand,
} from "../parser.js";

describe("findDevcontainerConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `devenv-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("finds .devcontainer/devcontainer.json", async () => {
		const devcontainerDir = join(tempDir, ".devcontainer");
		mkdirSync(devcontainerDir);
		writeFileSync(
			join(devcontainerDir, "devcontainer.json"),
			JSON.stringify({ image: "node:22" }),
		);

		const config = await findDevcontainerConfig(tempDir);
		expect(config).not.toBeNull();
		expect(config?.image).toBe("node:22");
	});

	it("finds .devcontainer.json in project root", async () => {
		writeFileSync(
			join(tempDir, ".devcontainer.json"),
			JSON.stringify({ image: "python:3.12" }),
		);

		const config = await findDevcontainerConfig(tempDir);
		expect(config).not.toBeNull();
		expect(config?.image).toBe("python:3.12");
	});

	it("prefers .devcontainer/devcontainer.json over .devcontainer.json", async () => {
		const devcontainerDir = join(tempDir, ".devcontainer");
		mkdirSync(devcontainerDir);
		writeFileSync(
			join(devcontainerDir, "devcontainer.json"),
			JSON.stringify({ image: "node:22" }),
		);
		writeFileSync(
			join(tempDir, ".devcontainer.json"),
			JSON.stringify({ image: "python:3.12" }),
		);

		const config = await findDevcontainerConfig(tempDir);
		expect(config?.image).toBe("node:22");
	});

	it("returns null when no config exists", async () => {
		const config = await findDevcontainerConfig(tempDir);
		expect(config).toBeNull();
	});
});

describe("resolveImage", () => {
	it("returns config image when present", () => {
		expect(resolveImage({ image: "golang:1.22" })).toBe("golang:1.22");
	});

	it("falls back to node:24 when no config", () => {
		expect(resolveImage(null)).toBe("node:24");
	});

	it("falls back to node:24 when image not set", () => {
		expect(resolveImage({})).toBe("node:24");
	});
});

describe("resolveForwardPorts", () => {
	it("returns configured ports", () => {
		expect(resolveForwardPorts({ forwardPorts: [8080, 5432] })).toEqual([
			8080, 5432,
		]);
	});

	it("falls back to default port when no config", () => {
		expect(resolveForwardPorts(null)).toEqual([3000]);
	});

	it("falls back to default port when empty array", () => {
		expect(resolveForwardPorts({ forwardPorts: [] })).toEqual([3000]);
	});
});

describe("resolveEnvVars", () => {
	it("merges containerEnv and remoteEnv", () => {
		const config = {
			containerEnv: { NODE_ENV: "development", FOO: "bar" },
			remoteEnv: { REMOTE_VAR: "value", FOO: "overridden" },
		};
		const env = resolveEnvVars(config);
		expect(env).toEqual({
			NODE_ENV: "development",
			FOO: "overridden",
			REMOTE_VAR: "value",
		});
	});

	it("returns empty object when no config", () => {
		expect(resolveEnvVars(null)).toEqual({});
	});

	it("handles only containerEnv", () => {
		expect(resolveEnvVars({ containerEnv: { A: "1" } })).toEqual({ A: "1" });
	});
});

describe("resolvePostCreateCommand", () => {
	it("returns string command as-is", () => {
		expect(resolvePostCreateCommand({ postCreateCommand: "npm install" })).toBe(
			"npm install",
		);
	});

	it("joins array command", () => {
		expect(
			resolvePostCreateCommand({
				postCreateCommand: ["npm", "install", "--frozen-lockfile"],
			}),
		).toBe("npm install --frozen-lockfile");
	});

	it("returns null when no config", () => {
		expect(resolvePostCreateCommand(null)).toBeNull();
	});

	it("returns null when postCreateCommand not set", () => {
		expect(resolvePostCreateCommand({})).toBeNull();
	});
});
