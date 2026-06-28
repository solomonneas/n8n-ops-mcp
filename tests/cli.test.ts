import { describe, expect, it, vi } from "vitest";
import { UsageError, VERSION, parseArgs, run, type CliDeps } from "../src/cli.ts";
import type { N8nClient } from "../src/client.ts";

function capture(
  client: Partial<N8nClient>,
  serve = vi.fn().mockResolvedValue(undefined),
) {
  const out: string[] = [];
  const err: string[] = [];
  const base = { redact: (t: string) => t, ...client } as unknown as N8nClient;
  const deps: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: () => base,
    getBaseUrl: () => "http://localhost:5678",
    serve,
  };
  return { out, err, deps, serve };
}

describe("parseArgs", () => {
  it("routes workflows list with filters", () => {
    expect(parseArgs(["workflows", "list", "--active", "--limit", "5", "--name", "sync"])).toEqual({
      kind: "workflows-list",
      json: false,
      active: true,
      tags: undefined,
      name: "sync",
      limit: 5,
    });
  });

  it("parses workflows get with --full and --json", () => {
    expect(parseArgs(["workflows", "get", "42", "--full", "--json"])).toEqual({
      kind: "workflows-get",
      json: true,
      id: "42",
      full: true,
    });
  });

  it("parses workflows diff with id + snapshot path", () => {
    expect(parseArgs(["workflows", "diff", "7", "/tmp/snap.json"])).toEqual({
      kind: "workflows-diff",
      json: false,
      id: "7",
      snapshotPath: "/tmp/snap.json",
    });
  });

  it("parses executions list with --status and --since", () => {
    expect(parseArgs(["executions", "list", "--status", "error", "--since", "12"])).toEqual({
      kind: "executions-list",
      json: false,
      status: "error",
      since: 12,
      workflowId: undefined,
      limit: undefined,
    });
  });

  it("parses executions search query after flags", () => {
    expect(parseArgs(["executions", "search", "ECONNREFUSED", "--scope", "all"])).toEqual({
      kind: "executions-search",
      json: false,
      query: "ECONNREFUSED",
      status: undefined,
      scope: "all",
      limit: undefined,
    });
  });

  it("parses nodes find with --contains", () => {
    expect(parseArgs(["nodes", "find", "n8n-nodes-base.slack", "--contains"])).toEqual({
      kind: "nodes-find",
      json: false,
      nodeType: "n8n-nodes-base.slack",
      match: "contains",
    });
  });

  it("routes simple commands and global flags", () => {
    expect(parseArgs(["tags", "list"])).toEqual({ kind: "tags-list", json: false, limit: undefined });
    expect(parseArgs(["credentials", "schema", "githubApi"])).toEqual({ kind: "credentials-schema", json: false, type: "githubApi" });
    expect(parseArgs(["audit", "run"])).toEqual({ kind: "audit-run", json: false });
    expect(parseArgs(["webhooks", "list", "--all"])).toEqual({ kind: "webhooks-list", json: false, activeOnly: false, limit: undefined });
    expect(parseArgs(["mcp"])).toEqual({ kind: "mcp" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs([])).toEqual({ kind: "help" });
  });

  it("rejects bad input with UsageError", () => {
    expect(() => parseArgs(["bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["workflows", "bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["workflows", "get"])).toThrow(UsageError);
    expect(() => parseArgs(["executions", "search"])).toThrow(UsageError);
    expect(() => parseArgs(["executions", "list", "--since", "999"])).toThrow(UsageError);
    expect(() => parseArgs(["workflows", "list", "--limit", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["tags", "list", "extra"])).toThrow(UsageError);
  });
});

describe("run", () => {
  it("prints human workflows-list output and exits 0", async () => {
    const client = {
      listWorkflows: vi.fn().mockResolvedValue({
        data: [{ id: "1", name: "Daily sync", active: true, tags: [{ name: "prod" }] }],
      }),
    };
    const { out, deps } = capture(client);
    const code = await run(["workflows", "list", "--active"], deps);
    expect(code).toBe(0);
    expect(client.listWorkflows).toHaveBeenCalledWith({
      active: true,
      tags: undefined,
      name: undefined,
      limit: undefined,
    });
    const text = out.join("\n");
    expect(text).toContain("Daily sync");
    expect(text).toContain("prod");
  });

  it("emits raw JSON with --json", async () => {
    const res = { data: [{ id: "9", name: "x", active: false }] };
    const client = { listWorkflows: vi.fn().mockResolvedValue(res) };
    const { out, deps } = capture(client);
    const code = await run(["workflows", "list", "--json"], deps);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual(res);
  });

  it("calls getWorkflow directly for workflows get", async () => {
    const client = {
      getWorkflow: vi.fn().mockResolvedValue({ id: "42", name: "wf", active: true, nodes: [], connections: {} }),
    };
    const { out, deps } = capture(client);
    expect(await run(["workflows", "get", "42"], deps)).toBe(0);
    expect(client.getWorkflow).toHaveBeenCalledWith("42");
    expect(out.join("\n")).toContain("id:        42");
  });

  it("validates a workflow via the client + pure validator", async () => {
    const client = {
      getWorkflow: vi.fn().mockResolvedValue({
        id: "5",
        name: "no-trigger",
        active: false,
        nodes: [{ name: "Set", type: "n8n-nodes-base.set" }],
        connections: {},
      }),
    };
    const { out, deps } = capture(client);
    expect(await run(["workflows", "validate", "5"], deps)).toBe(0);
    expect(out.join("\n")).toContain("missing-trigger");
  });

  it("audit run prints a report and exits 0 on a healthy audit", async () => {
    const client = {
      runAudit: vi.fn().mockResolvedValue({
        "Credentials Risk Report": { risk: "credentials", sections: [{ title: "x", location: [{}, {}] }] },
      }),
    };
    const { out, deps } = capture(client);
    expect(await run(["audit", "run"], deps)).toBe(0);
    expect(out.join("\n")).toContain("audit:");
  });

  it("audit run exits 1 when the backend is unreachable", async () => {
    const client = { runAudit: vi.fn().mockRejectedValue(new Error("403 Forbidden")) };
    const { err, deps } = capture(client);
    expect(await run(["audit", "run"], deps)).toBe(1);
    expect(err.join("\n")).toContain("403");
  });

  it("returns exit 1 and prints the error on client failure", async () => {
    const client = { listWorkflows: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) };
    const { err, deps } = capture(client);
    expect(await run(["workflows", "list"], deps)).toBe(1);
    expect(err.join("\n")).toContain("ECONNREFUSED");
  });

  it("returns exit 2 and prints help on usage error", async () => {
    const { err, deps } = capture({});
    expect(await run(["bogus"], deps)).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("prints the version", async () => {
    const { out, deps } = capture({});
    expect(await run(["--version"], deps)).toBe(0);
    expect(out.join("\n")).toBe(VERSION);
  });

  it("delegates `mcp` to serve()", async () => {
    const { deps, serve } = capture({});
    expect(await run(["mcp"], deps)).toBe(0);
    expect(serve).toHaveBeenCalledOnce();
  });

  it("redacts the API key from runtime error messages", async () => {
    const client = {
      redact: (t: string) => t.split("SECRET").join("***"),
      listTags: vi.fn().mockRejectedValue(new Error("boom SECRET leaked")),
    };
    const { err, deps } = capture(client);
    expect(await run(["tags", "list"], deps)).toBe(1);
    const text = err.join("\n");
    expect(text).toContain("***");
    expect(text).not.toContain("SECRET");
  });
});
