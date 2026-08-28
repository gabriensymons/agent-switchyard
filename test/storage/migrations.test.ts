import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { StorageError } from "../../src/storage/errors.js";
import {
  currentSchemaVersion,
  migrateDatabase,
  migrations,
  type Migration
} from "../../src/storage/migrations.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryDatabase(): Promise<Database.Database> {
  const root = await mkdtemp(join(tmpdir(), "switchyard-migrations-"));
  temporaryRoots.push(root);
  return new Database(join(root, "test.sqlite3"));
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => await rm(root, {
      recursive: true,
      force: true
    }))
  );
});

describe("SQLite migrations", () => {
  it("migrates an empty database to the current schema", async () => {
    const database = await temporaryDatabase();
    migrateDatabase(database, "2026-08-21T00:00:00.000Z");

    const versions = database.prepare(`
      SELECT version, applied_at FROM schema_migrations ORDER BY version
    `).all();
    const tables = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => (row as { name: string }).name);
    database.close();

    expect(versions).toEqual(migrations.map((migration) => ({
      version: migration.version,
      applied_at: "2026-08-21T00:00:00.000Z"
    })));
    expect(tables).toEqual([
      "artifacts",
      "attempts",
      "events",
      "questions",
      "repositories",
      "schema_migrations",
      "tasks",
      "verifications"
    ]);
  });

  it("migrates retained version-1 tasks to source identities and immutable requests", async () => {
    const database = await temporaryDatabase();
    migrateDatabase(
      database,
      "2026-08-21T00:00:00.000Z",
      migrations.slice(0, 1)
    );
    database.prepare(`
      INSERT INTO repositories(
        id, alias, canonical_root, worktree_root, default_branch,
        policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "repo-1",
      "fixture",
      "/repos/fixture",
      "/worktrees/fixture",
      "main",
      '{"schemaVersion":1}',
      "2026-08-21T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z"
    );
    database.prepare(`
      INSERT INTO tasks(
        id, schema_version, source_path, source_hash, source_revision,
        repository_id, title, objective, state, limits_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "task-1",
      1,
      "/intake/task.md",
      "sha256:abc",
      1,
      "repo-1",
      "Retained task",
      "Retain this task across migration.",
      "ingested",
      '{"schemaVersion":1}',
      "2026-08-21T00:00:01.000Z",
      "2026-08-21T00:00:01.000Z"
    );
    database.prepare(`
      INSERT INTO events(
        task_id, event_type, actor, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      "task-1",
      "task.ingested",
      "switchyard",
      '{"schemaVersion":1}',
      "2026-08-21T00:00:01.000Z"
    );

    migrateDatabase(database, "2026-08-21T00:01:00.000Z");

    expect(database.prepare(`
      SELECT id, source_path, source_identity, source_revision, source_hash,
             request_json
      FROM tasks
    `).get()).toEqual({
      id: "task-1",
      source_path: "/intake/task.md",
      source_identity: "legacy-path:/intake/task.md",
      source_revision: 1,
      source_hash: "sha256:abc",
      request_json: '{"schemaVersion":1,"kind":"legacy_storage_record"}'
    });
    expect(database.prepare(`
      SELECT event_type FROM events WHERE task_id = ?
    `).all("task-1")).toEqual([{ event_type: "task.ingested" }]);
    const taskColumns = database.prepare("PRAGMA table_info(tasks)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(taskColumns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "source_identity", notnull: 1 }),
      expect.objectContaining({ name: "request_json", notnull: 1 })
    ]));
    const indexNames = database.prepare("PRAGMA index_list(tasks)").all()
      .map((row) => (row as { name: string }).name);
    expect(indexNames).toEqual(expect.arrayContaining([
      "tasks_source_identity_hash_uq",
      "tasks_source_identity_revision_uq"
    ]));
    database.close();
  });

  it("retains repeated legacy hashes while enforcing new-source idempotency", async () => {
    const database = await temporaryDatabase();
    migrateDatabase(
      database,
      "2026-08-21T00:00:00.000Z",
      migrations.slice(0, 1)
    );
    database.prepare(`
      INSERT INTO repositories(
        id, alias, canonical_root, worktree_root, default_branch,
        policy_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "repo-1",
      "fixture",
      "/repos/fixture",
      "/worktrees/fixture",
      "main",
      '{"schemaVersion":1}',
      "2026-08-21T00:00:00.000Z",
      "2026-08-21T00:00:00.000Z"
    );
    const insertTask = database.prepare(`
      INSERT INTO tasks(
        id, schema_version, source_path, source_hash, source_revision,
        repository_id, title, objective, state, limits_json,
        created_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'ingested', ?, ?, ?)
    `);
    for (const [id, revision] of [["task-1", 1], ["task-2", 2]] as const) {
      insertTask.run(
        id,
        "/intake/task.md",
        "sha256:repeated",
        revision,
        "repo-1",
        `Retained task ${revision}`,
        "Retain this repeated historical hash.",
        '{"schemaVersion":1}',
        "2026-08-21T00:00:01.000Z",
        "2026-08-21T00:00:01.000Z"
      );
      database.prepare(`
        INSERT INTO events(
          task_id, event_type, actor, payload_json, occurred_at
        ) VALUES (?, 'task.ingested', 'switchyard', ?, ?)
      `).run(
        id,
        '{"schemaVersion":1}',
        "2026-08-21T00:00:01.000Z"
      );
    }

    migrateDatabase(database, "2026-08-21T00:01:00.000Z");

    expect(database.prepare(`
      SELECT id, source_identity, source_hash, source_revision
      FROM tasks ORDER BY source_revision
    `).all()).toEqual([
      {
        id: "task-1",
        source_identity: "legacy-path:/intake/task.md",
        source_hash: "sha256:repeated",
        source_revision: 1
      },
      {
        id: "task-2",
        source_identity: "legacy-path:/intake/task.md",
        source_hash: "sha256:repeated",
        source_revision: 2
      }
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM events").get())
      .toEqual({ count: 2 });
    database.close();
  });

  it("does not reapply migrations to an already-current database", async () => {
    const database = await temporaryDatabase();
    migrateDatabase(database, "2026-08-21T00:00:00.000Z");
    migrateDatabase(database, "2026-08-21T00:01:00.000Z");

    expect(database.prepare(`
      SELECT version, applied_at FROM schema_migrations ORDER BY version
    `).all()).toEqual(migrations.map((migration) => ({
      version: migration.version,
      applied_at: "2026-08-21T00:00:00.000Z"
    })));
    database.close();
  });

  it("serializes concurrent discovery for fresh and version-1 databases", async () => {
    const workerTest = join(
      dirname(fileURLToPath(import.meta.url)),
      "concurrent-migration-worker.test.ts"
    );
    const vitest = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
    const inheritedEnvironment = Object.fromEntries(Object.entries({
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR
    }).filter((entry): entry is [string, string] => entry[1] !== undefined));

    for (const scenario of ["fresh", "v2", "storage-open"] as const) {
      const stateRoot = await mkdtemp(join(tmpdir(), `switchyard-${scenario}-migration-`));
      const barrierRoot = await mkdtemp(join(tmpdir(), `switchyard-${scenario}-barrier-`));
      temporaryRoots.push(stateRoot, barrierRoot);
      if (scenario === "v2") {
        const seed = new Database(join(stateRoot, "test.sqlite3"));
        migrateDatabase(
          seed,
          "2026-08-27T00:00:00.000Z",
          migrations.slice(0, 1)
        );
        seed.close();
      }

      await Promise.all(["a", "b"].map(async (workerId) => {
        await execFileAsync(process.execPath, [vitest, "run", workerTest], {
          cwd: process.cwd(),
          env: {
            ...inheritedEnvironment,
            SWITCHYARD_MIGRATION_WORKER: workerId,
            SWITCHYARD_MIGRATION_STATE_ROOT: stateRoot,
            SWITCHYARD_MIGRATION_BARRIER_ROOT: barrierRoot,
            SWITCHYARD_MIGRATION_OUTPUT: join(barrierRoot, `result-${workerId}`),
            SWITCHYARD_MIGRATION_SCENARIO: scenario
          },
          timeout: 30_000
        });
      }));

      expect(await Promise.all(["a", "b"].map(async (workerId) =>
        await readFile(join(barrierRoot, `result-${workerId}`), "utf8")
      ))).toEqual(["ok", "ok"]);
      if (scenario === "storage-open") {
        for (let index = 0; index < 30; index += 1) {
          const database = new Database(join(
            stateRoot,
            `iteration-${index}`,
            "switchyard.sqlite3"
          ));
          expect(database.prepare(`
            SELECT version FROM schema_migrations ORDER BY version
          `).all()).toHaveLength(2);
          database.close();
        }
      } else {
        const database = new Database(join(stateRoot, "test.sqlite3"));
        expect(database.prepare(`
          SELECT version FROM schema_migrations ORDER BY version
        `).all()).toHaveLength(scenario === "fresh" ? 1 : 2);
        database.close();
      }
    }
  });

  it("restores foreign keys and rolls back a failed table migration", async () => {
    const database = await temporaryDatabase();
    database.pragma("foreign_keys = ON");
    migrateDatabase(
      database,
      "2026-08-21T00:00:00.000Z",
      migrations.slice(0, 1)
    );
    const failingMigrations: readonly Migration[] = [
      migrations[0]!,
      {
        version: 2,
        requiresForeignKeysDisabled: true,
        up(db) {
          db.exec("ALTER TABLE tasks ADD COLUMN should_rollback TEXT");
          throw new Error("SENSITIVE_MIGRATION_MARKER");
        }
      }
    ];

    expect(() => migrateDatabase(
      database,
      "2026-08-21T00:01:00.000Z",
      failingMigrations
    )).toThrowError(expect.objectContaining({ code: "migration_failed" }));

    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.prepare("PRAGMA table_info(tasks)").all()
      .map((row) => (row as { name: string }).name))
      .not.toContain("should_rollback");
    expect(database.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([{ version: 1 }]);
    database.close();
  });

  it("rolls back a failed migration and normalizes its error", async () => {
    const database = await temporaryDatabase();
    const testMigrations: readonly Migration[] = [
      {
        version: 1,
        up(db) {
          db.exec(`
            CREATE TABLE schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            CREATE TABLE stable (id INTEGER PRIMARY KEY);
          `);
        }
      },
      {
        version: 2,
        up(db) {
          db.exec("CREATE TABLE should_rollback (secret TEXT)");
          throw new Error("SENSITIVE_INPUT_MARKER");
        }
      }
    ];
    migrateDatabase(
      database,
      "2026-08-21T00:00:00.000Z",
      testMigrations.slice(0, 1)
    );

    let observed: unknown;
    try {
      migrateDatabase(
        database,
        "2026-08-21T00:01:00.000Z",
        testMigrations
      );
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(StorageError);
    expect(observed).toMatchObject({ code: "migration_failed" });
    expect(String(observed)).not.toContain("SENSITIVE_INPUT_MARKER");
    expect(database.prepare(`
      SELECT name FROM sqlite_master WHERE name = 'should_rollback'
    `).get()).toBeUndefined();
    expect(database.prepare(`
      SELECT version FROM schema_migrations ORDER BY version
    `).all()).toEqual([{ version: 1 }]);
    database.close();
  });

  it("refuses to auto-downgrade a newer schema", async () => {
    const database = await temporaryDatabase();
    migrateDatabase(database, "2026-08-21T00:00:00.000Z");
    database.prepare(`
      INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)
    `).run(currentSchemaVersion() + 1, "2026-08-21T00:01:00.000Z");

    expect(() => migrateDatabase(
      database,
      "2026-08-21T00:02:00.000Z",
      migrations
    )).toThrowError(expect.objectContaining({
      code: "schema_incompatible"
    }));
    database.close();
  });
});
