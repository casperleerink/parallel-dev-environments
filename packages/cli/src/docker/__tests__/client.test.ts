import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	CONTAINER_LABEL_PREFIX,
	CONTAINER_WORKSPACE_DIR,
	DOCKER_API_VERSION,
} from "@repo/shared";

// Store original fetch
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) =>
		Promise.resolve(handler(url.toString(), init)),
	) as unknown as typeof fetch;
}

beforeEach(() => {
	// Reset module cache so each test gets fresh imports
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("dockerFetch", () => {
	test("constructs correct URL with Docker API version", async () => {
		let capturedUrl = "";
		mockFetch((url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ Id: "abc123" }), { status: 200 });
		});

		// Dynamic import to pick up mocked fetch
		const { inspectContainer } = await import("../client.js");
		await inspectContainer("abc123");

		expect(capturedUrl).toContain(`/${DOCKER_API_VERSION}/`);
		expect(capturedUrl).toContain("/containers/abc123/json");
	});

	test("throws DockerError on non-ok response", async () => {
		mockFetch(() => {
			return new Response(JSON.stringify({ message: "container not found" }), {
				status: 404,
				statusText: "Not Found",
			});
		});

		const { inspectContainer, DockerError } = await import("../client.js");

		try {
			await inspectContainer("nonexistent");
			expect(true).toBe(false); // Should not reach here
		} catch (error) {
			expect(error).toBeInstanceOf(DockerError);
			expect((error as InstanceType<typeof DockerError>).statusCode).toBe(404);
			expect((error as InstanceType<typeof DockerError>).message).toBe(
				"container not found",
			);
		}
	});
});

describe("createContainer", () => {
	test("sends correct request body", async () => {
		let capturedBody: Record<string, unknown> = {};
		let capturedUrl = "";

		mockFetch((url, init) => {
			capturedUrl = url;
			capturedBody = JSON.parse(init?.body as string);
			return new Response(
				JSON.stringify({ Id: "new-container-id", Warnings: [] }),
				{ status: 201 },
			);
		});

		const { createContainer } = await import("../client.js");
		const containerId = await createContainer({
			name: "test-container",
			image: "node:20",
			workspaceDir: "/home/user/project",
			envVars: ["NODE_ENV=development"],
			labels: {
				[`${CONTAINER_LABEL_PREFIX}.project`]: "my-project",
			},
			portBindings: { "3000": "49200" },
		});

		expect(containerId).toBe("new-container-id");
		expect(capturedUrl).toContain("name=test-container");
		expect(capturedBody.Image).toBe("node:20");
		expect(capturedBody.Env).toEqual(["NODE_ENV=development"]);
		expect(capturedBody.WorkingDir).toBe(CONTAINER_WORKSPACE_DIR);
		expect(capturedBody.ExposedPorts).toEqual({ "3000/tcp": {} });

		const hostConfig = capturedBody.HostConfig as Record<string, unknown>;
		expect(hostConfig.Binds).toEqual([
			`/home/user/project:${CONTAINER_WORKSPACE_DIR}`,
		]);
		expect(hostConfig.PortBindings).toEqual({
			"3000/tcp": [{ HostPort: "49200" }],
		});
	});
});

describe("startContainer", () => {
	test("sends POST to correct endpoint", async () => {
		let capturedUrl = "";
		let capturedMethod = "";

		mockFetch((url, init) => {
			capturedUrl = url;
			capturedMethod = init?.method ?? "GET";
			return new Response(null, { status: 204 });
		});

		const { startContainer } = await import("../client.js");
		await startContainer("abc123");

		expect(capturedUrl).toContain("/containers/abc123/start");
		expect(capturedMethod).toBe("POST");
	});
});

describe("stopContainer", () => {
	test("sends POST to correct endpoint", async () => {
		let capturedUrl = "";
		let capturedMethod = "";

		mockFetch((url, init) => {
			capturedUrl = url;
			capturedMethod = init?.method ?? "GET";
			return new Response(null, { status: 204 });
		});

		const { stopContainer } = await import("../client.js");
		await stopContainer("abc123");

		expect(capturedUrl).toContain("/containers/abc123/stop");
		expect(capturedMethod).toBe("POST");
	});
});

describe("removeContainer", () => {
	test("sends DELETE with force=true", async () => {
		let capturedUrl = "";
		let capturedMethod = "";

		mockFetch((url, init) => {
			capturedUrl = url;
			capturedMethod = init?.method ?? "GET";
			return new Response(null, { status: 204 });
		});

		const { removeContainer } = await import("../client.js");
		await removeContainer("abc123");

		expect(capturedUrl).toContain("/containers/abc123");
		expect(capturedUrl).toContain("force=true");
		expect(capturedMethod).toBe("DELETE");
	});
});

describe("pullImage", () => {
	test("parses image name and tag", async () => {
		let capturedUrl = "";

		mockFetch((url) => {
			capturedUrl = url;
			return new Response("pulling layers...", { status: 200 });
		});

		const { pullImage } = await import("../client.js");
		await pullImage("node:20");

		expect(capturedUrl).toContain("fromImage=node");
		expect(capturedUrl).toContain("tag=20");
	});

	test("defaults tag to latest", async () => {
		let capturedUrl = "";

		mockFetch((url) => {
			capturedUrl = url;
			return new Response("pulling layers...", { status: 200 });
		});

		const { pullImage } = await import("../client.js");
		await pullImage("ubuntu");

		expect(capturedUrl).toContain("fromImage=ubuntu");
		expect(capturedUrl).toContain("tag=latest");
	});
});

describe("listContainers", () => {
	test("includes label filter in request", async () => {
		let capturedUrl = "";

		mockFetch((url) => {
			capturedUrl = url;
			return new Response(JSON.stringify([]), { status: 200 });
		});

		const { listContainers } = await import("../client.js");
		await listContainers("devenv.managed=true");

		expect(capturedUrl).toContain("all=true");
		expect(capturedUrl).toContain("filters=");
		expect(decodeURIComponent(capturedUrl)).toContain("devenv.managed=true");
	});

	test("works without filter", async () => {
		let capturedUrl = "";

		mockFetch((url) => {
			capturedUrl = url;
			return new Response(JSON.stringify([]), { status: 200 });
		});

		const { listContainers } = await import("../client.js");
		await listContainers();

		expect(capturedUrl).toContain("all=true");
		expect(capturedUrl).not.toContain("filters=");
	});
});

describe("execInContainer", () => {
	test("creates exec instance with correct command", async () => {
		const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];

		mockFetch((url, init) => {
			const entry: { url: string; body?: Record<string, unknown> } = { url };
			if (init?.body) {
				entry.body = JSON.parse(init.body as string);
			}
			calls.push(entry);

			if (url.includes("/exec") && !url.includes("/start")) {
				return new Response(JSON.stringify({ Id: "exec-123" }), {
					status: 201,
				});
			}
			return new Response(null, { status: 200 });
		});

		const { execInContainer } = await import("../client.js");
		const result = await execInContainer("abc123", ["/bin/sh"]);

		expect(result.execId).toBe("exec-123");
		expect(calls[0]?.url).toContain("/containers/abc123/exec");
		expect(calls[0]?.body?.Cmd).toEqual(["/bin/sh"]);
		expect(calls[0]?.body?.AttachStdin).toBe(true);
		expect(calls[0]?.body?.AttachStdout).toBe(true);
		expect(calls[0]?.body?.Tty).toBe(true);

		// Start the exec
		await result.start();
		expect(calls[1]?.url).toContain("/exec/exec-123/start");
		expect(calls[1]?.body?.Detach).toBe(false);
	});
});
