import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StorageError } from "../../src/storage/errors.js";
import {
  currentSchemaVersion,
  migrateDatabase,
  migrations,
  type Migration
} from "../../src/storage/migrations.js";

const temporaryRoots: string[] = [];

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

    expect(versions).toEqual([
      { version: currentSchemaVersion(), applied_at: "2026-08-21T00:00:00.000Z" }
    ]);
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

  it("does not reapply migrations to an already-current database", async () => {
    const database = await temporaryDatabase();
    migrateDatabase(database, "2026-08-21T00:00:00.000Z");
    migrateDatabase(database, "2026-08-21T00:01:00.000Z");

    expect(database.prepare(`
      SELECT version, applied_at FROM schema_migrations
    `).all()).toEqual([
      { version: 1, applied_at: "2026-08-21T00:00:00.000Z" }
    ]);
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
      INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)
    `).run("2026-08-21T00:01:00.000Z");

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
