import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { N8nApiError, N8nClient } from "../src/client.ts";
import { makeFakeFetch, type FakeFetch } from "./helpers-fetch.ts";

const BASE = "https://n8n.example.com";
const API_KEY = "super-secret-api-key-abc123";

function buildClient(overrides: Partial<ConstructorParameters<typeof N8nClient>[0]> = {}) {
  return new N8nClient({
    baseUrl: BASE,
    apiKey: API_KEY,
    ...overrides,
  });
}

describe("N8nClient wire shape", () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = makeFakeFetch();
  });

  afterEach(() => {
    fake.restore();
  });

  describe("stopExecution", () => {
    it("POSTs to /api/v1/executions/{id}/stop with no body and the API key header", async () => {
      fake.queue({ status: 200, body: { id: "42", finished: true, mode: "trigger", workflowId: "wf-1", status: "canceled" } });
      const client = buildClient();

      const result = await client.stopExecution("42");

      expect(fake.calls).toHaveLength(1);
      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions/42/stop`);
      expect(call.method).toBe("POST");
      expect(call.body).toBeNull();
      expect(call.headers["x-n8n-api-key"]).toBe(API_KEY);
      expect(call.headers["accept"]).toBe("application/json");
      expect(call.headers["content-type"]).toBeUndefined();
      expect(result.id).toBe("42");
    });

    it("rejects invalid execution ids before touching the network", async () => {
      const client = buildClient();
      await expect(client.stopExecution("../../etc/passwd")).rejects.toThrow(/Invalid execution id/);
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("retryExecution", () => {
    it("POSTs with no body when loadWorkflow is omitted", async () => {
      fake.queue({ status: 200, body: { id: "43", finished: false, mode: "trigger", workflowId: "wf-1" } });
      const client = buildClient();

      await client.retryExecution("42");

      expect(fake.calls).toHaveLength(1);
      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions/42/retry`);
      expect(call.method).toBe("POST");
      expect(call.body).toBeNull();
      expect(call.headers["content-type"]).toBeUndefined();
    });

    it("sends {loadWorkflow: true} in the body when requested", async () => {
      fake.queue({ status: 200, body: { id: "43", finished: false, mode: "trigger", workflowId: "wf-1" } });
      const client = buildClient();

      await client.retryExecution("42", { loadWorkflow: true });

      const [call] = fake.calls;
      expect(call.method).toBe("POST");
      expect(call.body).toBe(JSON.stringify({ loadWorkflow: true }));
      expect(call.headers["content-type"]).toBe("application/json");
    });

    it("sends {loadWorkflow: false} explicitly when opts.loadWorkflow is false", async () => {
      fake.queue({ status: 200, body: { id: "43", finished: false, mode: "trigger", workflowId: "wf-1" } });
      const client = buildClient();

      await client.retryExecution("42", { loadWorkflow: false });

      const [call] = fake.calls;
      expect(call.body).toBe(JSON.stringify({ loadWorkflow: false }));
    });
  });

  describe("deleteExecution", () => {
    it("sends DELETE /api/v1/executions/{id} with no body", async () => {
      fake.queue({ status: 200, body: { id: "42", finished: true, mode: "trigger", workflowId: "wf-1", status: "error" } });
      const client = buildClient();

      await client.deleteExecution("42");

      expect(fake.calls).toHaveLength(1);
      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions/42`);
      expect(call.method).toBe("DELETE");
      expect(call.body).toBeNull();
      expect(call.headers["x-n8n-api-key"]).toBe(API_KEY);
    });
  });

  describe("deleteExecutions", () => {
    it("fires exactly N DELETEs in input order at concurrency=1", async () => {
      fake.queue(
        { status: 200, body: { id: "1", finished: true, mode: "trigger", workflowId: "wf-1" } },
        { status: 200, body: { id: "2", finished: true, mode: "trigger", workflowId: "wf-1" } },
        { status: 200, body: { id: "3", finished: true, mode: "trigger", workflowId: "wf-1" } },
      );
      const client = buildClient();

      const results = await client.deleteExecutions(["1", "2", "3"], { concurrency: 1 });

      expect(fake.calls).toHaveLength(3);
      expect(fake.calls.map((c) => c.url)).toEqual([
        `${BASE}/api/v1/executions/1`,
        `${BASE}/api/v1/executions/2`,
        `${BASE}/api/v1/executions/3`,
      ]);
      expect(fake.calls.every((c) => c.method === "DELETE")).toBe(true);
      expect(fake.calls.every((c) => c.body === null)).toBe(true);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.ok)).toBe(true);
    });

    it("marks per-id 404 as already_deleted without aborting the batch", async () => {
      fake.queue(
        { status: 200, body: { id: "1", finished: true, mode: "trigger", workflowId: "wf-1" } },
        { status: 404, text: `{"message":"not found"}` },
        { status: 200, body: { id: "3", finished: true, mode: "trigger", workflowId: "wf-1" } },
      );
      const client = buildClient();

      const results = await client.deleteExecutions(["1", "2", "3"], { concurrency: 1 });

      expect(fake.calls).toHaveLength(3);
      const byId = Object.fromEntries(results.map((r) => [r.id, r]));
      expect(byId["1"].ok).toBe(true);
      expect(byId["2"].ok).toBe(true);
      expect(byId["2"].reason).toBe("already_deleted");
      expect(byId["3"].ok).toBe(true);
    });

    it("aborts remaining work on the first 5xx and returns partial results", async () => {
      fake.queue(
        { status: 200, body: { id: "1", finished: true, mode: "trigger", workflowId: "wf-1" } },
        { status: 500, text: `upstream exploded key=${API_KEY}` },
      );
      const client = buildClient();

      const results = await client.deleteExecutions(["1", "2", "3"], { concurrency: 1 });

      expect(fake.calls).toHaveLength(2);
      expect(results).toHaveLength(2);
      const failed = results.find((r) => !r.ok)!;
      expect(failed.id).toBe("2");
      expect(failed.reason).toBe("server_error");
      expect(failed.message).toContain("***REDACTED***");
      expect(failed.message).not.toContain(API_KEY);
    });

    it("rejects invalid ids before any request fires", async () => {
      const client = buildClient();
      await expect(
        client.deleteExecutions(["1", "../../etc/passwd", "3"]),
      ).rejects.toThrow(/Invalid execution id/);
      expect(fake.calls).toHaveLength(0);
    });

    it("respects concurrency: at most N fetches are live at once", async () => {
      // Use a deferred-response pattern to observe in-flight count. The fake
      // fetch has no per-request delay API, so we monkey-patch a gate directly.
      fake.restore();
      let live = 0;
      let peakLive = 0;
      const calls: string[] = [];
      let releaseAll: (() => void) | null = null;
      const allQueued = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });
      globalThis.fetch = (async (input: string) => {
        calls.push(input);
        live++;
        if (live > peakLive) peakLive = live;
        if (calls.length >= 3) releaseAll?.();
        await allQueued;
        live--;
        return new Response(
          JSON.stringify({ id: "x", finished: true, mode: "trigger", workflowId: "wf-1" }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;

      const client = buildClient();
      const results = await client.deleteExecutions(
        ["1", "2", "3", "4", "5", "6"],
        { concurrency: 3 },
      );

      expect(results).toHaveLength(6);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(peakLive).toBeLessThanOrEqual(3);
      expect(peakLive).toBe(3);
    });

    it("aborts in-flight fetches on the first 5xx under concurrency>1", async () => {
      fake.restore();
      const calls: string[] = [];
      const aborted: string[] = [];
      // Simulate: id=1 returns 200 fast, id=2 returns 500 after a tick,
      // id=3,4,5 "hang" until their AbortSignal fires. After the 500 lands,
      // the batch controller should abort id=3..5.
      globalThis.fetch = (async (
        input: string,
        init: RequestInit = {},
      ) => {
        const id = input.split("/").pop()!;
        calls.push(id);
        const signal = init.signal as AbortSignal | undefined;

        if (id === "1") {
          return new Response(
            JSON.stringify({ id: "1", finished: true, mode: "trigger", workflowId: "wf-1" }),
            { status: 200 },
          );
        }
        if (id === "2") {
          await new Promise((r) => setTimeout(r, 10));
          return new Response("boom", { status: 500 });
        }
        // ids 3+ hang until their signal aborts
        return new Promise<Response>((_, reject) => {
          if (!signal) {
            reject(new Error("no signal"));
            return;
          }
          if (signal.aborted) {
            aborted.push(id);
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
            return;
          }
          signal.addEventListener("abort", () => {
            aborted.push(id);
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          }, { once: true });
        });
      }) as unknown as typeof fetch;

      const client = buildClient();
      const results = await client.deleteExecutions(
        ["1", "2", "3", "4", "5"],
        { concurrency: 3 },
      );

      // Workers = 3: initially claim 1, 2, 3. Worker on 1 finishes fast, claims 4.
      // Worker on 2 gets 500 → aborts. 3, 4 in flight get AbortSignal.
      // Id 5 should never be claimed.
      expect(calls).not.toContain("5");
      // At least one of the hung ids (3 or 4) must see its abort fire.
      expect(aborted.length).toBeGreaterThanOrEqual(1);

      // The 500 for id=2 must appear as server_error; id=1 as ok.
      const byId = Object.fromEntries(results.map((r) => [r.id, r]));
      expect(byId["1"]?.ok).toBe(true);
      expect(byId["2"]?.reason).toBe("server_error");
      // In-flight aborted ids are NOT in results (intentionally skipped).
      expect(byId["5"]).toBeUndefined();
    });
  });

  describe("getExecution", () => {
    it("GETs /api/v1/executions/{id} with no query when includeData is omitted", async () => {
      fake.queue({ status: 200, body: { id: "42", finished: true, mode: "trigger", workflowId: "wf-1" } });
      const client = buildClient();

      await client.getExecution("42");

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions/42`);
      expect(call.method).toBe("GET");
      expect(call.body).toBeNull();
    });

    it("appends ?includeData=true when requested", async () => {
      fake.queue({ status: 200, body: { id: "42", finished: true, mode: "trigger", workflowId: "wf-1" } });
      const client = buildClient();

      await client.getExecution("42", { includeData: true });

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions/42?includeData=true`);
    });

    it("does NOT append the query when includeData is false", async () => {
      fake.queue({ status: 200, body: { id: "42", finished: true, mode: "trigger", workflowId: "wf-1" } });
      const client = buildClient();

      await client.getExecution("42", { includeData: false });

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions/42`);
    });
  });

  describe("listExecutions", () => {
    it("GETs the collection with no query by default", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient();

      await client.listExecutions();

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/executions`);
      expect(call.method).toBe("GET");
    });

    it("forwards workflowId, status, limit, cursor, and includeData as query params", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient();

      await client.listExecutions({
        workflowId: "wf-1",
        status: "error",
        limit: 10,
        cursor: "next-token",
        includeData: true,
      });

      const [call] = fake.calls;
      const parsed = new URL(call.url);
      expect(parsed.pathname).toBe("/api/v1/executions");
      expect(parsed.searchParams.get("workflowId")).toBe("wf-1");
      expect(parsed.searchParams.get("status")).toBe("error");
      expect(parsed.searchParams.get("limit")).toBe("10");
      expect(parsed.searchParams.get("cursor")).toBe("next-token");
      expect(parsed.searchParams.get("includeData")).toBe("true");
    });

    it("omits includeData when falsy", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient();

      await client.listExecutions({ workflowId: "wf-1", includeData: false });

      const parsed = new URL(fake.calls[0].url);
      expect(parsed.searchParams.has("includeData")).toBe(false);
    });
  });

  describe("listWorkflows", () => {
    it("GETs the collection with no query by default", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient();

      await client.listWorkflows();

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows`);
      expect(call.method).toBe("GET");
    });

    it("forwards every filter as a query param", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient();

      await client.listWorkflows({
        active: true,
        tags: "prod",
        name: "intel",
        limit: 5,
        cursor: "abc",
      });

      const [call] = fake.calls;
      const parsed = new URL(call.url);
      expect(parsed.pathname).toBe("/api/v1/workflows");
      expect(parsed.searchParams.get("active")).toBe("true");
      expect(parsed.searchParams.get("tags")).toBe("prod");
      expect(parsed.searchParams.get("name")).toBe("intel");
      expect(parsed.searchParams.get("limit")).toBe("5");
      expect(parsed.searchParams.get("cursor")).toBe("abc");
    });
  });

  describe("getWorkflow", () => {
    it("GETs /api/v1/workflows/{id} and parses JSON", async () => {
      fake.queue({
        status: 200,
        body: {
          id: "wf-1",
          name: "intel",
          active: true,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          nodes: [],
          connections: {},
        },
      });
      const client = buildClient();

      const wf = await client.getWorkflow("wf-1");

      expect(wf.id).toBe("wf-1");
      expect(wf.name).toBe("intel");
      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1`);
      expect(call.method).toBe("GET");
    });

    it("rejects invalid workflow ids before touching the network", async () => {
      const client = buildClient();
      await expect(client.getWorkflow("has space")).rejects.toThrow(/Invalid workflow id/);
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("createWorkflow", () => {
    it("POSTs /api/v1/workflows with the JSON body and Content-Type", async () => {
      fake.queue({
        status: 200,
        body: {
          id: "wf-new-1",
          name: "restored",
          active: false,
          createdAt: "2026-04-23T00:00:00Z",
          updatedAt: "2026-04-23T00:00:00Z",
          nodes: [],
          connections: {},
        },
      });
      const client = buildClient();

      const body = {
        name: "restored",
        nodes: [],
        connections: {},
        settings: {},
      };
      const result = await client.createWorkflow(body);

      expect(fake.calls).toHaveLength(1);
      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows`);
      expect(call.method).toBe("POST");
      expect(call.body).toBe(JSON.stringify(body));
      expect(call.headers["content-type"]).toBe("application/json");
      expect(call.headers["x-n8n-api-key"]).toBe(API_KEY);
      expect(result.id).toBe("wf-new-1");
    });
  });

  describe("saveWorkflow", () => {
    it("PUTs /api/v1/workflows/{id} with the given body and Content-Type", async () => {
      fake.queue({
        status: 200,
        body: {
          id: "wf-1",
          name: "renamed",
          active: false,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
          nodes: [],
          connections: {},
        },
      });
      const client = buildClient();

      const body = { name: "renamed", nodes: [], connections: {} };
      await client.saveWorkflow("wf-1", body);

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1`);
      expect(call.method).toBe("PUT");
      expect(call.body).toBe(JSON.stringify(body));
      expect(call.headers["content-type"]).toBe("application/json");
    });
  });

  describe("activateWorkflow / deactivateWorkflow", () => {
    it("POSTs /api/v1/workflows/{id}/activate with no body", async () => {
      fake.queue({
        status: 200,
        body: { id: "wf-1", name: "x", active: true, createdAt: "", updatedAt: "", nodes: [], connections: {} },
      });
      const client = buildClient();

      await client.activateWorkflow("wf-1");

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1/activate`);
      expect(call.method).toBe("POST");
      expect(call.body).toBeNull();
      expect(call.headers["content-type"]).toBeUndefined();
    });

    it("POSTs /api/v1/workflows/{id}/deactivate with no body", async () => {
      fake.queue({
        status: 200,
        body: { id: "wf-1", name: "x", active: false, createdAt: "", updatedAt: "", nodes: [], connections: {} },
      });
      const client = buildClient();

      await client.deactivateWorkflow("wf-1");

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1/deactivate`);
      expect(call.method).toBe("POST");
      expect(call.body).toBeNull();
    });
  });

  describe("archiveWorkflow / unarchiveWorkflow / deleteWorkflow", () => {
    it("POSTs /api/v1/workflows/{id}/archive with no body", async () => {
      fake.queue({
        status: 200,
        body: { id: "wf-1", name: "x", active: false, isArchived: true, createdAt: "", updatedAt: "", nodes: [], connections: {} },
      });
      const client = buildClient();

      await client.archiveWorkflow("wf-1");

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1/archive`);
      expect(call.method).toBe("POST");
      expect(call.body).toBeNull();
      expect(call.headers["content-type"]).toBeUndefined();
      expect(call.headers["x-n8n-api-key"]).toBe(API_KEY);
    });

    it("POSTs /api/v1/workflows/{id}/unarchive with no body", async () => {
      fake.queue({
        status: 200,
        body: { id: "wf-1", name: "x", active: false, isArchived: false, createdAt: "", updatedAt: "", nodes: [], connections: {} },
      });
      const client = buildClient();

      await client.unarchiveWorkflow("wf-1");

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1/unarchive`);
      expect(call.method).toBe("POST");
      expect(call.body).toBeNull();
    });

    it("sends DELETE /api/v1/workflows/{id} with no body", async () => {
      fake.queue({
        status: 200,
        body: { id: "wf-1", name: "x", active: false, createdAt: "", updatedAt: "", nodes: [], connections: {} },
      });
      const client = buildClient();

      await client.deleteWorkflow("wf-1");

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1`);
      expect(call.method).toBe("DELETE");
      expect(call.body).toBeNull();
      expect(call.headers["x-n8n-api-key"]).toBe(API_KEY);
    });

    it("rejects invalid ids for all three before touching the network", async () => {
      const client = buildClient();
      await expect(client.archiveWorkflow("../../etc/passwd")).rejects.toThrow(/Invalid workflow id/);
      await expect(client.unarchiveWorkflow("has space")).rejects.toThrow(/Invalid workflow id/);
      await expect(client.deleteWorkflow("path/traversal")).rejects.toThrow(/Invalid workflow id/);
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe("executeWorkflow", () => {
    it("POSTs /api/v1/workflows/{id}/execute with the JSON payload", async () => {
      fake.queue({ status: 200, body: { executionId: "new-1" } });
      const client = buildClient();

      await client.executeWorkflow("wf-1", { topic: "hn" });

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows/wf-1/execute`);
      expect(call.method).toBe("POST");
      expect(call.body).toBe(JSON.stringify({ topic: "hn" }));
      expect(call.headers["content-type"]).toBe("application/json");
    });

    it("sends an empty object body when payload is omitted", async () => {
      fake.queue({ status: 200, body: {} });
      const client = buildClient();

      await client.executeWorkflow("wf-1");

      expect(fake.calls[0].body).toBe("{}");
    });
  });

  describe("postWebhook", () => {
    it("defaults to POST with a JSON body + Content-Type", async () => {
      fake.queue({ status: 200, body: { ok: true } });
      const client = buildClient();

      const res = await client.postWebhook("/webhook/intel", { topic: "hn" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/webhook/intel`);
      expect(call.method).toBe("POST");
      expect(call.body).toBe(JSON.stringify({ topic: "hn" }));
      expect(call.headers["content-type"]).toBe("application/json");
      // webhook path does NOT get the n8n API key header
      expect(call.headers["x-n8n-api-key"]).toBeUndefined();
    });

    it("normalizes webhook paths missing a leading slash", async () => {
      fake.queue({ status: 200, body: null });
      const client = buildClient();

      await client.postWebhook("webhook/intel", {});

      expect(fake.calls[0].url).toBe(`${BASE}/webhook/intel`);
    });

    it("suppresses body + Content-Type on GET", async () => {
      fake.queue({ status: 200, body: { ok: true } });
      const client = buildClient();

      await client.postWebhook("/webhook/ping", { anything: true }, { method: "GET" });

      const [call] = fake.calls;
      expect(call.method).toBe("GET");
      expect(call.body).toBeNull();
      expect(call.headers["content-type"]).toBeUndefined();
    });

    it("returns body=null when the webhook response is empty", async () => {
      fake.queue({ status: 200, text: "" });
      const client = buildClient();

      const res = await client.postWebhook("/webhook/noop", {});

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it("returns the raw text body when the response is non-JSON", async () => {
      fake.queue({ status: 200, text: "plain-text-reply" });
      const client = buildClient();

      const res = await client.postWebhook("/webhook/echo", {});

      expect(res.body).toBe("plain-text-reply");
    });

    it("redacts the API key from thrown errors in its own catch wrapper", async () => {
      fake.queue({ rejectWith: new Error(`connect ECONNREFUSED key=${API_KEY}`) });
      const client = buildClient();

      let caught: unknown;
      try {
        await client.postWebhook("/webhook/intel", {});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).toContain("n8n webhook to /webhook/intel failed");
      expect(msg).toContain("***REDACTED***");
      expect(msg).not.toContain(API_KEY);
    });
  });

  describe("request()", () => {
    it("returns {} on an empty 2xx body instead of throwing on JSON.parse", async () => {
      fake.queue({ status: 200, text: "" });
      const client = buildClient();

      const wf = await client.getWorkflow("wf-1");

      expect(wf).toEqual({});
    });

    it("throws N8nApiError on non-ok responses", async () => {
      fake.queue({ status: 500, text: "boom" });
      const client = buildClient();

      await expect(client.getWorkflow("wf-1")).rejects.toMatchObject({
        name: "N8nApiError",
        status: 500,
        path: "/api/v1/workflows/wf-1",
      });
    });

    it("aborts via the timeout branch and the rejection message is still redacted", async () => {
      fake.queue({ hangUntilAbort: true });
      const client = buildClient({ timeoutMs: 5 });

      let caught: unknown;
      try {
        await client.getWorkflow("wf-1");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).toContain("/api/v1/workflows/wf-1");
      // API key must not be in the thrown message (even though abort messages
      // don't normally contain it, the redaction path still runs).
      expect(msg).not.toContain(API_KEY);
    });
  });

  describe("baseUrl normalization", () => {
    it("strips trailing slashes from baseUrl", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient({ baseUrl: `${BASE}///` });

      await client.listWorkflows();

      const [call] = fake.calls;
      expect(call.url).toBe(`${BASE}/api/v1/workflows`);
    });
  });

  describe("redactKey end-to-end", () => {
    it("redacts the API key from the N8nApiError message when the server echoes it back", async () => {
      fake.queue({
        status: 401,
        text: `{"message":"invalid key: ${API_KEY}"}`,
      });
      const client = buildClient();

      let caught: unknown;
      try {
        await client.getWorkflow("wf-1");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(N8nApiError);
      expect((caught as N8nApiError).status).toBe(401);
      const msg = (caught as Error).message;
      expect(msg).toContain("***REDACTED***");
      expect(msg).not.toContain(API_KEY);
    });

    it("redacts the API key from generic network-error messages too", async () => {
      fake.queue({ rejectWith: new Error(`connect ECONNREFUSED key=${API_KEY}`) });
      const client = buildClient();

      let caught: unknown;
      try {
        await client.getWorkflow("wf-1");
      } catch (err) {
        caught = err;
      }
      const msg = (caught as Error).message;
      expect(msg).toContain("***REDACTED***");
      expect(msg).not.toContain(API_KEY);
    });

    it("redacts the API key from string rejections (non-Error throws)", async () => {
      fake.queue({ rejectWith: `string rejection leaking ${API_KEY}` });
      const client = buildClient();

      let caught: unknown;
      try {
        await client.getWorkflow("wf-1");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).toContain("***REDACTED***");
      expect(msg).not.toContain(API_KEY);
    });

    it("client.redact() replaces the key in arbitrary text", () => {
      const client = buildClient();
      const out = client.redact(`Bearer ${API_KEY} trailing`);
      expect(out).toBe("Bearer ***REDACTED*** trailing");
    });
  });

  describe("createCredential body-stripping on error", () => {
    it("never includes the response body or echoed `data` in the thrown error message", async () => {
      const secretToken = "ghp_super_secret_should_not_leak";
      // n8n echoes back the request body on a 400 — common when the
      // credential type is unknown. Our client must NOT propagate that
      // body to the tool layer, or `data` could leak into agent context.
      fake.queue({
        status: 400,
        body: {
          message: "type 'bogusType' is not supported",
          data: { token: secretToken },
        },
      });
      const client = buildClient();

      let caught: unknown;
      try {
        await client.createCredential({
          name: "test",
          type: "bogusType",
          data: { token: secretToken },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(N8nApiError);
      const apiErr = caught as N8nApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.path).toBe("/api/v1/credentials");
      expect(apiErr.message).not.toContain(secretToken);
      expect(apiErr.message).not.toContain("bogusType");
    });

    it("never includes body fragments when n8n returns malformed 2xx (JSON.parse leak path)", async () => {
      // V8's JSON.parse SyntaxError messages include a slice of the
      // unparseable text. On a malformed 2xx that echoes the request
      // body — possible from a buggy n8n release or a misbehaving
      // proxy — a credential secret could leak through the parse-error
      // message. The wrapper must catch ALL error classes, not only
      // N8nApiError.
      const secretFragment = "ghp_super_secret_should_not_leak";
      fake.queue({
        status: 200,
        // Not valid JSON — V8's parser will surface a slice of this in
        // the SyntaxError.
        text: `not-json ${secretFragment}`,
      });
      const client = buildClient();

      let caught: unknown;
      try {
        await client.createCredential({
          name: "GH",
          type: "githubApi",
          data: { token: secretFragment },
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const msg = (caught as Error).message;
      expect(msg).not.toContain(secretFragment);
      // Also assert the wrapper didn't preserve the original via `cause`
      // — `cause`'s message would carry the leak too.
      expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    });

    it("returns the credential on success", async () => {
      fake.queue({
        status: 200,
        body: {
          id: "c1",
          name: "GH",
          type: "githubApi",
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T00:00:00.000Z",
        },
      });
      const client = buildClient();

      const created = await client.createCredential({
        name: "GH",
        type: "githubApi",
        data: { token: "x" },
      });

      expect(created.id).toBe("c1");
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].method).toBe("POST");
      expect(fake.calls[0].url).toBe(`${BASE}/api/v1/credentials`);
    });
  });

  describe("listCredentials + deleteCredential wire shape", () => {
    it("listCredentials forwards limit + cursor", async () => {
      fake.queue({ status: 200, body: { data: [] } });
      const client = buildClient();
      await client.listCredentials({ limit: 50, cursor: "abc" });
      expect(fake.calls[0].url).toContain("limit=50");
      expect(fake.calls[0].url).toContain("cursor=abc");
    });

    it("getCredentialSchema URL-encodes the type name", async () => {
      fake.queue({ status: 200, body: { type: "object" } });
      const client = buildClient();
      await client.getCredentialSchema("githubApi");
      expect(fake.calls[0].url).toBe(
        `${BASE}/api/v1/credentials/schema/githubApi`,
      );
    });

    it("getCredentialSchema rejects unsafe type names before hitting the network", async () => {
      const client = buildClient();
      await expect(
        client.getCredentialSchema("../../etc/passwd"),
      ).rejects.toThrow(/Invalid credential type/);
      expect(fake.calls).toHaveLength(0);
    });

    it("deleteCredential rejects unsafe ids before hitting the network", async () => {
      const client = buildClient();
      await expect(
        client.deleteCredential("../../etc/passwd"),
      ).rejects.toThrow(/Invalid credential id/);
      expect(fake.calls).toHaveLength(0);
    });
  });
});
