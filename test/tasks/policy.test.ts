import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RepositoryRecord } from "../../src/storage/types.js";
import { parseTaskDocument } from "../../src/tasks/document.js";
import { resolveTaskRequest } from "../../src/tasks/policy.js";

const validFixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "tasks",
  "valid.md"
);

function repository(overrides: Partial<RepositoryRecord["policy"]> = {}): RepositoryRecord {
  return {
    id: "repo-1",
    alias: "fixture-repo",
    canonicalRoot: "/repos/fixture",
    worktreeRoot: "/worktrees/fixture",
    defaultBranch: "main",
    policy: {
      schemaVersion: 1,
      operatingMode: "local-only",
      allowedPaths: ["src/**", "test/**"],
      forbiddenPaths: ["src/generated/**"],
      providerIdentities: ["codex-isolated"],
      verificationCommands: [{
        id: "test-targeted",
        executable: "npm",
        args: ["test", "--", "focused"],
        cwd: ".",
        timeoutMs: 60_000
      }],
      limits: {
        runtimeMinutes: 20,
        attempts: 2,
        changedFiles: 10,
        diffLines: 1_000,
        changedFileBytes: 256 * 1024,
        commandOutputBytes: 1024 * 1024
      },
      ...overrides
    },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z"
  };
}

async function validDocument() {
  return parseTaskDocument(await readFile(validFixture));
}

describe("task policy narrowing", () => {
  it("resolves an immutable execution request from the repository ceiling", async () => {
    expect(resolveTaskRequest(await validDocument(), repository())).toEqual({
      schemaVersion: 1,
      kind: "resolved_task_request",
      repository: { id: "repo-1", alias: "fixture-repo" },
      title: "Add a focused regression test",
      objective: "Implement only the stated regression fix.",
      acceptanceCriteria: [
        "The regression test fails before the fix and passes after it."
      ],
      providerIdentity: "codex-isolated",
      allowedPaths: ["src/example.ts", "test/example.test.ts"],
      forbiddenPaths: ["src/generated/**"],
      verificationCommands: [{
        id: "test-targeted",
        executable: "npm",
        args: ["test", "--", "focused"],
        cwd: ".",
        timeoutMs: 60_000
      }],
      limits: {
        schemaVersion: 1,
        runtimeMinutes: 15,
        attempts: 1,
        changedFiles: 4,
        diffLines: 300,
        changedFileBytes: 131072,
        commandOutputBytes: 524288
      }
    });
  });

  it("inherits every missing task limit from repository maxima", async () => {
    const document = await validDocument();
    delete document.limits;

    expect(resolveTaskRequest(document, repository()).limits).toEqual({
      schemaVersion: 1,
      ...repository().policy.limits
    });
  });

  it("rejects a task runtime below a selected registered command timeout", async () => {
    const document = await validDocument();
    document.limits = { ...document.limits!, runtimeMinutes: 1 };
    const policy = repository({
      verificationCommands: [{
        id: "test-targeted",
        executable: "npm",
        args: ["test", "--", "focused"],
        cwd: ".",
        timeoutMs: 120_000
      }]
    });

    expect(() => resolveTaskRequest(document, policy)).toThrowError(
      expect.objectContaining({ code: "policy_rejected" })
    );
  });

  it("rejects provider, path, verification, and limit expansion", async () => {
    const base = await validDocument();
    const cases = [
      { ...base, providerIdentity: "codex-default" as const },
      { ...base, allowedPaths: ["docs/outside.md"] },
      { ...base, allowedPaths: ["src/generated/output.ts"] },
      { ...base, allowedPaths: ["src/GENERATED/output.ts"] },
      { ...base, allowedPaths: ["src/example.ts", "src/EXAMPLE.ts"] },
      { ...base, verification: ["unregistered"] },
      {
        ...base,
        limits: { ...base.limits!, runtimeMinutes: 21 }
      }
    ];

    for (const document of cases) {
      expect(() => resolveTaskRequest(document, repository())).toThrowError(
        expect.objectContaining({ code: "policy_rejected" })
      );
    }
  });
});
