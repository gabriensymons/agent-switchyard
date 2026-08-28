import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStorage } from "../../src/storage/sqlite.js";
import type { CreateRepositoryInput } from "../../src/storage/types.js";
import { TaskIntakeService } from "../../src/tasks/intake.js";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "tasks"
);
const temporaryRoots: string[] = [];
const stores: SqliteStorage[] = [];
const execFileAsync = promisify(execFile);

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function repository(): CreateRepositoryInput {
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
      }
    },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z"
  };
}

async function setup() {
  const intakeRoot = await temporaryRoot("switchyard-intake-service-");
  const stateRoot = await temporaryRoot("switchyard-state-");
  const taskPath = join(intakeRoot, "task.md");
  await copyFile(join(fixturesRoot, "valid.md"), taskPath);
  const store = SqliteStorage.open({ stateRoot });
  stores.push(store);
  store.createRepository(repository());
  let nextId = 1;
  const service = new TaskIntakeService({
    storage: store,
    intakeRoot,
    idGenerator: () => `generated-${nextId++}`,
    now: () => new Date("2026-08-27T00:00:01.000Z")
  });
  return { intakeRoot, stateRoot, taskPath, store, service };
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test may close a connection while retaining its state root.
    }
  }
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true });
  }));
});

describe("TaskIntakeService", () => {
  it("imports new bytes as an immutable ingested task and one event", async () => {
    const { service, store } = await setup();

    const task = await service.import("task.md");

    expect(task).toMatchObject({
      id: "generated-1",
      sourceIdentity: "id:stable-task",
      sourceRevision: 1,
      repositoryId: "repo-1",
      state: "ingested",
      revision: 0,
      limits: {
        schemaVersion: 1,
        runtimeMinutes: 15,
        attempts: 1,
        changedFiles: 4,
        diffLines: 300,
        changedFileBytes: 131072,
        commandOutputBytes: 524288
      },
      request: {
        schemaVersion: 1,
        kind: "resolved_task_request",
        repository: { id: "repo-1", alias: "fixture-repo" }
      }
    });
    expect(store.eventsForTask(task.id)).toMatchObject([{
      eventType: "task.ingested",
      payload: {
        schemaVersion: 1,
        sourceIdentity: "id:stable-task",
        sourceRevision: 1
      }
    }]);
  });

  it("is idempotent for current and historical exact bytes", async () => {
    const { service, taskPath, store } = await setup();
    const original = await readFile(taskPath);
    const first = await service.import("task.md");
    const same = await service.import("task.md");
    const changedBytes = Buffer.from(original.toString("utf8").replace(
      "title: Add a focused regression test",
      "title: Add a second focused regression test"
    ));
    await writeFile(taskPath, changedBytes);
    const second = await service.import("task.md");
    await writeFile(taskPath, original);
    const historical = await service.import("task.md");

    expect(same).toEqual(first);
    expect(second).toMatchObject({ id: "generated-2", sourceRevision: 2 });
    expect(historical).toEqual(first);
    expect(store.getTask(first.id)?.title).toBe("Add a focused regression test");
    expect(store.eventsForTask(first.id)).toHaveLength(1);
    expect(store.eventsForTask(second.id)).toHaveLength(1);
  });

  it("allocates a new revision when only newline bytes change", async () => {
    const { service, taskPath } = await setup();
    const lf = await service.import("task.md");
    const crlfBytes = (await readFile(taskPath, "utf8")).replaceAll("\n", "\r\n");
    await writeFile(taskPath, crlfBytes);

    const crlf = await service.import("task.md");

    expect(crlf.sourceRevision).toBe(2);
    expect(crlf.sourceHash).not.toBe(lf.sourceHash);
  });

  it("uses the canonical path identity when id is absent", async () => {
    const { service, taskPath } = await setup();
    const withoutId = (await readFile(taskPath, "utf8")).replace(
      "id: stable-task\n",
      ""
    );
    await writeFile(taskPath, withoutId);

    const task = await service.import("task.md");

    expect(task.sourceIdentity).toBe(`path:${task.sourcePath}`);
    expect(task.sourceRevision).toBe(1);
  });

  it("allocates revision one for a new explicit identity at the same path", async () => {
    const { service, taskPath } = await setup();
    const first = await service.import("task.md");
    const changedIdentity = (await readFile(taskPath, "utf8")).replace(
      "id: stable-task",
      "id: other-stable-task"
    );
    await writeFile(taskPath, changedIdentity);

    const second = await service.import("task.md");

    expect(first).toMatchObject({
      sourceIdentity: "id:stable-task",
      sourceRevision: 1
    });
    expect(second).toMatchObject({
      sourceIdentity: "id:other-stable-task",
      sourceRevision: 1
    });
  });

  it("fails unsafe, invalid, or policy-expanding input before any database write", async () => {
    const { service, taskPath, store } = await setup();
    const outsideRoot = await temporaryRoot("switchyard-outside-intake-");
    const outsidePath = join(outsideRoot, "outside.md");
    await copyFile(join(fixturesRoot, "valid.md"), outsidePath);
    await expect(service.import(outsidePath)).rejects.toMatchObject({
      code: "source_file_unsafe"
    });

    await copyFile(join(fixturesRoot, "unknown-key.md"), taskPath);
    await expect(service.import("task.md")).rejects.toMatchObject({
      code: "invalid_input"
    });

    const valid = await readFile(join(fixturesRoot, "valid.md"), "utf8");
    await writeFile(taskPath, valid.replace(
      "  - src/example.ts",
      "  - docs/not-allowed.md"
    ));
    await expect(service.import("task.md")).rejects.toMatchObject({
      code: "policy_rejected"
    });

    const database = new Database(store.databasePath, { readonly: true });
    expect(database.prepare("SELECT COUNT(*) AS count FROM tasks").get())
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM events").get())
      .toEqual({ count: 0 });
    database.close();
  });

  it("uses one generic policy error for missing and rejected repositories", async () => {
    const { service, taskPath } = await setup();
    const valid = await readFile(join(fixturesRoot, "valid.md"), "utf8");
    await writeFile(taskPath, valid.replace(
      "  - src/example.ts",
      "  - docs/not-allowed.md"
    ));
    const rejected = await service.import("task.md").catch((error: unknown) => error);
    await writeFile(taskPath, valid.replace(
      "repository: fixture-repo",
      "repository: missing-repo"
    ));
    const missing = await service.import("task.md").catch((error: unknown) => error);

    expect(rejected).toMatchObject({ code: "policy_rejected" });
    expect(missing).toMatchObject({ code: "policy_rejected" });
    expect(String(missing)).toBe(String(rejected));
  });

  it("converges concurrent imports through SQLite constraints and lookup", async () => {
    const { intakeRoot, stateRoot, store } = await setup();
    const barrierRoot = await temporaryRoot("switchyard-import-barrier-");
    const workerTest = join(
      dirname(fileURLToPath(import.meta.url)),
      "concurrent-import-worker.test.ts"
    );
    const vitest = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
    const inheritedEnvironment = Object.fromEntries(Object.entries({
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR
    }).filter((entry): entry is [string, string] => entry[1] !== undefined));

    await Promise.all(["a", "b"].map(async (workerId) => {
      await execFileAsync(process.execPath, [
        vitest,
        "run",
        workerTest
      ], {
        cwd: process.cwd(),
        env: {
          ...inheritedEnvironment,
          SWITCHYARD_CONCURRENT_WORKER: workerId,
          SWITCHYARD_CONCURRENT_STATE_ROOT: stateRoot,
          SWITCHYARD_CONCURRENT_INTAKE_ROOT: intakeRoot,
          SWITCHYARD_CONCURRENT_BARRIER_ROOT: barrierRoot,
          SWITCHYARD_CONCURRENT_OUTPUT: join(barrierRoot, `result-${workerId}.json`)
        },
        timeout: 30_000
      });
    }));

    const results = await Promise.all(["a", "b"].map(async (workerId) =>
      JSON.parse(await readFile(
        join(barrierRoot, `result-${workerId}.json`),
        "utf8"
      )) as { id: string; sourceRevision: number }
    ));
    const first = results[0]!;
    const second = results[1]!;
    expect(second).toEqual(first);
    expect(store.eventsForTask(first.id)).toHaveLength(1);
    const database = new Database(store.databasePath, { readonly: true });
    expect(database.prepare("SELECT COUNT(*) AS count FROM tasks").get())
      .toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM events").get())
      .toEqual({ count: 1 });
    database.close();
  });
});
