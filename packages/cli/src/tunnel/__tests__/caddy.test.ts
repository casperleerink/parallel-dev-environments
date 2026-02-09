import { afterEach, describe, expect, mock, test } from "bun:test";
import { CADDY_ADMIN_URL, CADDY_HOST_GATEWAY } from "@repo/shared";

const originalFetch = globalThis.fetch;

interface FetchCall {
	url: string;
	method: string;
	body?: Record<string, unknown>;
}

function mockFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
	globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) =>
		Promise.resolve(handler(url.toString(), init)),
	) as unknown as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("addRoute", () => {
	test("initializes server config then adds route", async () => {
		const calls: FetchCall[] = [];

		mockFetch((url, init) => {
			const call: FetchCall = {
				url,
				method: init?.method ?? "GET",
			};
			if (init?.body) {
				call.body = JSON.parse(init.body as string);
			}
			calls.push(call);

			// Server config check — return 404 first time, 200 after PUT
			if (
				url.includes("/servers/devenv") &&
				!url.includes("/routes") &&
				!url.includes("/id/")
			) {
				if (call.method === "GET") {
					return new Response(null, { status: 404 });
				}
				return new Response(null, { status: 200 });
			}

			// Route upsert via /id/ — return 404 to trigger POST fallback
			if (url.includes("/id/")) {
				return new Response(null, { status: 404 });
			}

			// Route append via POST
			return new Response(null, { status: 200 });
		});

		const { addRoute } = await import("../caddy.js");
		await addRoute("devenv-myapp-main", "myapp-main.localhost", 49200);

		// Should have: GET server config, PUT server config, PUT /id/, POST routes
		const routeCall = calls.find(
			(c) => c.url.includes("/routes") && c.method === "POST",
		);
		expect(routeCall).toBeDefined();
		expect(routeCall?.body?.["@id"]).toBe("devenv-myapp-main");
		expect(routeCall?.body?.match).toEqual([
			{ host: ["myapp-main.localhost"] },
		]);

		const handle = routeCall?.body?.handle as Array<Record<string, unknown>>;
		expect(handle[0]?.handler).toBe("reverse_proxy");
		expect(handle[0]?.upstreams).toEqual([
			{ dial: `${CADDY_HOST_GATEWAY}:49200` },
		]);
	});

	test("uses /id/ upsert when route already exists", async () => {
		const calls: FetchCall[] = [];

		mockFetch((url, init) => {
			calls.push({
				url,
				method: init?.method ?? "GET",
			});

			// Server config exists
			if (
				url.includes("/servers/devenv") &&
				!url.includes("/routes") &&
				!url.includes("/id/")
			) {
				return new Response(JSON.stringify({ listen: [":80"], routes: [] }), {
					status: 200,
				});
			}

			// Route upsert via /id/ succeeds
			if (url.includes("/id/")) {
				return new Response(null, { status: 200 });
			}

			return new Response(null, { status: 200 });
		});

		const { addRoute } = await import("../caddy.js");
		await addRoute("devenv-myapp-main", "myapp-main.localhost", 49200);

		// Should NOT have a POST to /routes since /id/ succeeded
		const postToRoutes = calls.find(
			(c) => c.url.includes("/routes") && c.method === "POST",
		);
		expect(postToRoutes).toBeUndefined();
	});
});

describe("removeRoute", () => {
	test("sends DELETE to /id/ endpoint", async () => {
		let capturedUrl = "";
		let capturedMethod = "";

		mockFetch((url, init) => {
			capturedUrl = url;
			capturedMethod = init?.method ?? "GET";
			return new Response(null, { status: 200 });
		});

		const { removeRoute } = await import("../caddy.js");
		await removeRoute("devenv-myapp-main");

		expect(capturedUrl).toBe(`${CADDY_ADMIN_URL}/id/devenv-myapp-main`);
		expect(capturedMethod).toBe("DELETE");
	});

	test("does not throw on 404", async () => {
		mockFetch(() => {
			return new Response(null, { status: 404 });
		});

		const { removeRoute } = await import("../caddy.js");
		await removeRoute("nonexistent-route");
		// Should not throw
	});
});

describe("listRoutes", () => {
	test("returns routes from Caddy API", async () => {
		const routes = [
			{
				"@id": "devenv-myapp-main",
				match: [{ host: ["myapp-main.localhost"] }],
				handle: [
					{
						handler: "reverse_proxy",
						upstreams: [{ dial: "host.docker.internal:49200" }],
					},
				],
			},
		];

		mockFetch(() => {
			return new Response(JSON.stringify(routes), { status: 200 });
		});

		const { listRoutes } = await import("../caddy.js");
		const result = await listRoutes();

		expect(result).toHaveLength(1);
		expect(result[0]?.["@id"]).toBe("devenv-myapp-main");
	});

	test("returns empty array on error", async () => {
		mockFetch(() => {
			return new Response(null, { status: 500 });
		});

		const { listRoutes } = await import("../caddy.js");
		const result = await listRoutes();

		expect(result).toEqual([]);
	});

	test("returns empty array on network error", async () => {
		mockFetch(() => {
			throw new Error("Connection refused");
		});

		const { listRoutes } = await import("../caddy.js");
		const result = await listRoutes();

		expect(result).toEqual([]);
	});
});
