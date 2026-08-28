import Database from "better-sqlite3";
import {
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStorage } from "../../src/storage/sqlite.js";
import type { ResolvedTaskRequest } from "../../src/tasks/policy.js";
import type {
  CreateRepositoryInput,
  CreateTaskInput,
  ImportTaskInput
} from "../../src/storage/types.js";

const temporaryRoots: string[] = [];
const openStores: SqliteStorage[] = [];
const SOURCE_HASH_A = `sha256:${"a".repeat(64)}`;
const SOURCE_HASH_D = `sha256:${"d".repeat(64)}`;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchyard-sqlite-"));
  temporaryRoots.push(root);
  return root;
}

async function openStorage(): Promise<{ root: string; store: SqliteStorage }> {
  const root = await temporaryRoot();
  const store = SqliteStorage.open({
    stateRoot: root,
    now: () => new Date("2026-08-21T00:00:00.000Z")
  });
  openStores.push(store);
  return { root, store };
}

function repository(
  overrides: Partial<CreateRepositoryInput> = {}
): CreateRepositoryInput {
  return {
    id: "repo-1",
    alias: "fixture",
    canonicalRoot: "/repos/fixture",
    worktreeRoot: "/worktrees/fixture",
    defaultBranch: "main",
    policy: {
      schemaVersion: 1,
      operatingMode: "local-only",
      allowedPaths: ["src/**"],
      forbiddenPaths: ["generated/**"],
      providerIdentities: ["codex-isolated"],
      verificationCommands: [
        {
          id: "test",
          executable: "npm",
          args: ["test"],
          cwd: ".",
          timeoutMs: 60_000
        }
      ],
      limits: {
        runtimeMinutes: 20,
        attempts: 2,
        changedFiles: 10,
        diffLines: 1_000,
        changedFileBytes: 256 * 1024,
        commandOutputBytes: 1024 * 1024
      }
    },
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides
  };
}

function task(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  const limits = {
    schemaVersion: 1,
    runtimeMinutes: 15,
    attempts: 1,
    changedFiles: 4,
    diffLines: 300,
    changedFileBytes: 131_072,
    commandOutputBytes: 524_288
  };
  return {
    id: "task-1",
    schemaVersion: 1,
    sourcePath: "/intake/task-1.md",
    sourceIdentity: "path:/intake/task-1.md",
    sourceHash: SOURCE_HASH_A,
    sourceRevision: 1,
    repositoryId: "repo-1",
    title: "Focused task",
    objective: "Prove transactional state and event persistence.",
    state: "ingested",
    limits,
    request: {
      schemaVersion: 1,
      kind: "resolved_task_request",
      repository: { id: "repo-1", alias: "fixture" },
      title: "Focused task",
      objective: "Prove transactional state and event persistence.",
      acceptanceCriteria: ["The storage contract remains atomic."],
      providerIdentity: "codex-isolated",
      allowedPaths: ["src/example.ts"],
      forbiddenPaths: ["generated/**"],
      verificationCommands: [{
        id: "test",
        executable: "npm",
        args: ["test"],
        cwd: ".",
        timeoutMs: 60_000
      }],
      limits
    },
    createdAt: "2026-08-21T00:00:01.000Z",
    updatedAt: "2026-08-21T00:00:01.000Z",
    actor: "switchyard",
    eventPayload: { schemaVersion: 1, sourceRevision: 1 },
    ...overrides
  };
}

function importedTask(overrides: Partial<ImportTaskInput> = {}): ImportTaskInput {
  const input = { ...task() } as Partial<CreateTaskInput>;
  delete input.sourceRevision;
  return {
    ...(input as ImportTaskInput),
    eventPayload: { schemaVersion: 1 },
    ...overrides
  };
}

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test may already have closed the store to prove reopening.
    }
  }
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, {
      recursive: true,
      force: true
    }))
  );
});

describe("SqliteStorage", () => {
  it("rejects an empty state root without touching the working directory", () => {
    expect(() => SqliteStorage.open({ stateRoot: "" })).toThrowError(
      expect.objectContaining({ code: "open_failed" })
    );
  });

  it("rejects symlinked private storage paths", async () => {
    if (process.platform === "win32") return;
    const stateRootParent = await temporaryRoot();
    const stateRootTarget = await temporaryRoot();
    const stateRootLink = join(stateRootParent, "state-root");
    await symlink(stateRootTarget, stateRootLink);

    expect(() => SqliteStorage.open({ stateRoot: stateRootLink })).toThrowError(
      expect.objectContaining({ code: "open_failed" })
    );

    const databaseRoot = await temporaryRoot();
    const databaseTarget = join(databaseRoot, "target.sqlite3");
    await writeFile(databaseTarget, "");
    await symlink(databaseTarget, join(databaseRoot, "switchyard.sqlite3"));

    expect(() => SqliteStorage.open({ stateRoot: databaseRoot })).toThrowError(
      expect.objectContaining({ code: "open_failed" })
    );

    const artifactsRoot = await temporaryRoot();
    const artifactsTarget = await temporaryRoot();
    await symlink(artifactsTarget, join(artifactsRoot, "artifacts"));

    expect(() => SqliteStorage.open({ stateRoot: artifactsRoot })).toThrowError(
      expect.objectContaining({ code: "open_failed" })
    );
  });

  it("uses required pragmas and private state permissions", async () => {
    const { root, store } = await openStorage();

    expect(store.diagnostics()).toEqual({
      journalMode: "wal",
      foreignKeys: true,
      busyTimeoutMs: 5_000
    });
    if (process.platform !== "win32") {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, "artifacts"))).mode & 0o777).toBe(0o700);
      const databaseFiles = (await readdir(root))
        .filter((entry) => entry.startsWith("switchyard.sqlite3"));
      expect(databaseFiles.length).toBeGreaterThan(0);
      for (const entry of databaseFiles) {
        expect((await stat(join(root, entry))).mode & 0o777).toBe(0o600);
      }
    }
  });

  it("round-trips a repository and its immutable policy snapshot", async () => {
    const { root, store } = await openStorage();
    const input = repository();
    const expectedPolicy = structuredClone(input.policy);
    const created = store.createRepository(input);
    (input.policy.limits as { changedFiles: number }).changedFiles = 99;
    store.close();

    const reopened = SqliteStorage.open({ stateRoot: root });
    openStores.push(reopened);

    expect(created.policy).toEqual(expectedPolicy);
    expect(reopened.getRepository("repo-1")).toEqual({
      ...repository(),
      policy: expectedPolicy
    });
  });

  it("resolves repositories by alias and lists them deterministically", async () => {
    const { store } = await openStorage();
    const second = repository({
      id: "repo-2",
      alias: "zeta",
      canonicalRoot: "/repos/zeta",
      worktreeRoot: "/worktrees/zeta"
    });
    const first = repository({ alias: "alpha" });
    store.createRepository(second);
    store.createRepository(first);

    expect(store.getRepositoryByAlias("alpha")).toEqual(first);
    expect(store.getRepositoryByAlias("missing")).toBeNull();
    expect(store.listRepositories()).toEqual([first, second]);
  });

  it("rejects unsupported repository policy on write and read", async () => {
    const { root, store } = await openStorage();
    expect(() =>
      store.createRepository(
        repository({ policy: { schemaVersion: 1 } as never })
      )
    ).toThrowError(expect.objectContaining({ code: "write_failed" }));

    store.createRepository(repository());
    const databasePath = store.databasePath;
    store.close();
    const database = new Database(databasePath);
    database.prepare(`
      UPDATE repositories SET policy_json = ? WHERE id = ?
    `).run('{"schemaVersion":99}', "repo-1");
    database.close();
    const reopened = SqliteStorage.open({ stateRoot: root });
    openStores.push(reopened);
    expect(() => reopened.getRepository("repo-1")).toThrowError(
      expect.objectContaining({ code: "schema_incompatible" })
    );
  });

  it("commits task state and its append-only event together", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());
    store.createTask(task());

    const ready = store.transitionTask({
      taskId: "task-1",
      expectedRevision: 0,
      to: "ready",
      actor: "switchyard",
      payload: { schemaVersion: 1, reason: "validated" },
      occurredAt: "2026-08-21T00:00:02.000Z"
    });

    expect(ready).toMatchObject({ state: "ready", revision: 1 });
    expect(store.eventsForTask("task-1")).toMatchObject([
      {
        sequence: 1,
        eventType: "task.ingested",
        payload: { schemaVersion: 1, sourceRevision: 1 }
      },
      {
        sequence: 2,
        eventType: "task.state_changed",
        payload: {
          schemaVersion: 1,
          reason: "validated",
          from: "ingested",
          to: "ready",
          revision: 1
        }
      }
    ]);
  });

  it("validates, cross-checks, and freezes resolved task requests", async () => {
    const { root, store } = await openStorage();
    store.createRepository(repository());
    const mismatched = task({
      limits: {
        ...(task().limits),
        attempts: 2
      }
    });
    expect(() => store.createTask(mismatched)).toThrowError(
      expect.objectContaining({ code: "constraint_violation" })
    );
    expect(() => store.createTask(task({
      request: { schemaVersion: 1, kind: "legacy_storage_record" }
    }))).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
    expect(() => store.createTask(task({
      sourceIdentity: "legacy-path:/intake/task.md"
    }))).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
    expect(() => store.createTask(task({
      sourceHash: "sha256:not-a-hash"
    }))).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
    expect(() => store.createTask(task({
      request: {
        ...task().request,
        allowedPaths: ["GENERATED/output.ts"]
      }
    }))).toThrowError(expect.objectContaining({ code: "constraint_violation" }));
    expect(() => store.createTask(task({
      request: {
        ...task().request,
        verificationCommands: [{
          id: "test",
          executable: "npm",
          args: ["test", "--", "unregistered"],
          cwd: ".",
          timeoutMs: 60_000
        }]
      }
    }))).toThrowError(expect.objectContaining({ code: "constraint_violation" }));

    const baseRequest = task().request as unknown as ResolvedTaskRequest;
    const storedRequest = (
      overrides: Record<string, unknown>
    ): CreateTaskInput["request"] => ({
      ...baseRequest,
      ...overrides
    }) as unknown as CreateTaskInput["request"];
    const invalidRequests: CreateTaskInput[] = [
      task({ title: " ", request: storedRequest({ title: " " }) }),
      task({ objective: " ", request: storedRequest({ objective: " " }) }),
      task({
        request: storedRequest({
          acceptanceCriteria: [
            ...baseRequest.acceptanceCriteria,
            ...baseRequest.acceptanceCriteria
          ]
        })
      }),
      task({
        request: storedRequest({
          verificationCommands: [
            ...baseRequest.verificationCommands,
            ...baseRequest.verificationCommands
          ]
        })
      })
    ];
    for (const invalid of invalidRequests) {
      expect(() => store.createTask(invalid)).toThrowError(
        expect.objectContaining({ code: "constraint_violation" })
      );
    }

    const created = store.createTask(task());
    expect(Object.isFrozen(created.limits)).toBe(true);
    expect(Object.isFrozen(created.request)).toBe(true);
    expect(Object.isFrozen(created.request.verificationCommands)).toBe(true);
    store.close();

    const database = new Database(join(root, "switchyard.sqlite3"));
    database.prepare(`
      UPDATE tasks SET request_json = ? WHERE id = ?
    `).run(JSON.stringify({
      ...task().request,
      verificationCommands: [{
        id: "test",
        executable: "npm",
        args: ["test", "--", "tampered"],
        cwd: ".",
        timeoutMs: 60_000
      }]
    }), "task-1");
    database.close();
    const reopened = SqliteStorage.open({ stateRoot: root });
    openStores.push(reopened);
    expect(() => reopened.getTask("task-1")).toThrowError(
      expect.objectContaining({ code: "schema_incompatible" })
    );
  });

  it("imports source revisions idempotently and returns historical hashes", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());

    const first = store.importTask(importedTask());
    const same = store.importTask(importedTask({ id: "task-duplicate" }));
    const second = store.importTask(importedTask({
      id: "task-2",
      sourceHash: SOURCE_HASH_D
    }));
    const historical = store.importTask(importedTask({
      id: "task-historical",
      sourceHash: SOURCE_HASH_A
    }));

    expect(first).toMatchObject({ id: "task-1", sourceRevision: 1 });
    expect(same).toEqual(first);
    expect(second).toMatchObject({ id: "task-2", sourceRevision: 2 });
    expect(historical).toEqual(first);
    expect(store.getTaskBySourceHash(
      "path:/intake/task-1.md",
      SOURCE_HASH_D
    )).toEqual(second);
    expect(store.eventsForTask("task-1")).toHaveLength(1);
    expect(store.eventsForTask("task-2")).toHaveLength(1);
    expect(store.getTask("task-duplicate")).toBeNull();
    expect(store.getTask("task-historical")).toBeNull();
  });

  it("rolls back an imported task when its event cannot be inserted", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());

    expect(() => store.importTask(importedTask({ actor: "" }))).toThrowError(
      expect.objectContaining({ code: "constraint_violation" })
    );
    expect(store.getTask("task-1")).toBeNull();
    expect(store.eventsForTask("task-1")).toEqual([]);
  });

  it("enforces append-only events and immutable terminal attempts", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());
    store.createTask(task());
    const databasePath = store.databasePath;
    store.close();
    const database = new Database(databasePath);
    database.pragma("foreign_keys = ON");
    database.prepare(`
      INSERT INTO attempts(
        id, task_id, sequence, provider_identity, state, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "attempt-1",
      "task-1",
      1,
      "codex-isolated",
      "preparing",
      "2026-08-21T00:00:02.000Z"
    );
    database.prepare(`
      UPDATE attempts SET state = 'verifying' WHERE id = 'attempt-1'
    `).run();
    database.prepare(`
      UPDATE attempts
      SET state = 'failed', finished_at = '2026-08-21T00:00:03.000Z'
      WHERE id = 'attempt-1'
    `).run();

    expect(() => database.prepare(`
      UPDATE events SET actor = 'rewriter' WHERE sequence = 1
    `).run()).toThrow(/append-only/u);
    expect(() => database.prepare(`
      DELETE FROM events WHERE sequence = 1
    `).run()).toThrow(/append-only/u);
    expect(() => database.prepare(`
      UPDATE attempts SET state = 'completed' WHERE id = 'attempt-1'
    `).run()).toThrow(/immutable/u);
    expect(() => database.prepare(`
      DELETE FROM attempts WHERE id = 'attempt-1'
    `).run()).toThrow(/immutable/u);
    database.close();
  });

  it("rejects verification artifacts owned by another task or attempt", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());
    store.createTask(task());
    store.createRepository(repository({
      id: "repo-2",
      alias: "other-fixture",
      canonicalRoot: "/repos/other-fixture",
      worktreeRoot: "/worktrees/other-fixture"
    }));
    store.createTask(task({
      id: "task-2",
      repositoryId: "repo-2",
      sourcePath: "/intake/task-2.md",
      sourceIdentity: "path:/intake/task-2.md",
      request: {
        ...task().request,
        repository: { id: "repo-2", alias: "other-fixture" }
      }
    }));
    const databasePath = store.databasePath;
    store.close();
    const database = new Database(databasePath);
    database.pragma("foreign_keys = ON");
    database.prepare(`
      INSERT INTO artifacts(
        id, task_id, kind, absolute_path, sha256, byte_size, media_type,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "artifact-2",
      "task-2",
      "verification_stdout",
      "/artifacts/task-2/stdout.txt",
      "sha256:def",
      4,
      "text/plain",
      "2026-08-21T00:00:02.000Z"
    );

    expect(() => database.prepare(`
      INSERT INTO verifications(
        id, task_id, command_id, argv_json, cwd_relative, state,
        stdout_artifact_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "verification-1",
      "task-1",
      "test",
      '["npm","test"]',
      ".",
      "passed",
      "artifact-2"
    )).toThrow();

    database.prepare(`
      INSERT INTO attempts(id, task_id, sequence, provider_identity, state)
      VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
    `).run(
      "attempt-1",
      "task-1",
      1,
      "codex-isolated",
      "queued",
      "attempt-2",
      "task-1",
      2,
      "codex-isolated",
      "queued"
    );
    database.prepare(`
      INSERT INTO artifacts(
        id, task_id, attempt_id, kind, absolute_path, sha256, byte_size,
        media_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "artifact-1",
      "task-1",
      "attempt-2",
      "verification_stdout",
      "/artifacts/task-1/attempt-2/stdout.txt",
      "sha256:ghi",
      4,
      "text/plain",
      "2026-08-21T00:00:02.000Z"
    );

    expect(() => database.prepare(`
      INSERT INTO verifications(
        id, task_id, attempt_id, command_id, argv_json, cwd_relative, state,
        stdout_artifact_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "verification-2",
      "task-1",
      "attempt-1",
      "test",
      '["npm","test"]',
      ".",
      "passed",
      "artifact-1"
    )).toThrow();

    expect(() => database.prepare(`
      INSERT INTO verifications(
        id, task_id, attempt_id, command_id, argv_json, cwd_relative, state,
        stdout_artifact_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "verification-3",
      "task-1",
      "attempt-2",
      "test",
      '["npm","test"]',
      ".",
      "passed",
      "artifact-1"
    )).not.toThrow();
    database.close();
  });

  it("rolls back a state update when its event insert fails", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());
    store.createTask(task());

    expect(() => store.transitionTask({
      taskId: "task-1",
      expectedRevision: 0,
      to: "ready",
      attemptId: "missing-attempt",
      actor: "switchyard",
      payload: { schemaVersion: 1 },
      occurredAt: "2026-08-21T00:00:02.000Z"
    })).toThrowError(expect.objectContaining({
      code: "constraint_violation"
    }));

    expect(store.getTask("task-1")).toMatchObject({
      state: "ingested",
      revision: 0
    });
    expect(store.eventsForTask("task-1")).toHaveLength(1);
  });

  it("rejects stale and invalid transitions without changing state or events", async () => {
    const { store } = await openStorage();
    store.createRepository(repository());
    store.createTask(task());

    expect(() => store.transitionTask({
      taskId: "task-1",
      expectedRevision: 1,
      to: "ready",
      actor: "switchyard",
      payload: { schemaVersion: 1 },
      occurredAt: "2026-08-21T00:00:02.000Z"
    })).toThrowError(expect.objectContaining({ code: "stale_revision" }));
    expect(() => store.transitionTask({
      taskId: "task-1",
      expectedRevision: 0,
      to: "review",
      actor: "switchyard",
      payload: { schemaVersion: 1 },
      occurredAt: "2026-08-21T00:00:02.000Z"
    })).toThrowError(expect.objectContaining({ code: "invalid_transition" }));

    expect(store.getTask("task-1")).toMatchObject({
      state: "ingested",
      revision: 0
    });
    expect(store.eventsForTask("task-1")).toHaveLength(1);
  });

  it("enforces foreign keys and does not expose sensitive input in errors", async () => {
    const { store } = await openStorage();
    const sensitive = "SENSITIVE_INPUT_MARKER";

    let observed: unknown;
    try {
      store.createTask(task({
        repositoryId: "missing-repository",
        sourcePath: sensitive
      }));
    } catch (error) {
      observed = error;
    }

    expect(observed).toMatchObject({ code: "constraint_violation" });
    expect(String(observed)).not.toContain(sensitive);
    expect(store.getTask("task-1")).toBeNull();
    expect(store.eventsForTask("task-1")).toEqual([]);
  });
});
