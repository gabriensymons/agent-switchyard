import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateDatabase,
  type Migration
} from "../../src/storage/migrations.js";
import { SqliteStorage } from "../../src/storage/sqlite.js";

const workerId = process.env.SWITCHYARD_MIGRATION_WORKER;

describe.skipIf(!workerId)("concurrent migration worker", () => {
  it("migrates after both processes reach the discovery boundary", () => {
    const stateRoot = process.env.SWITCHYARD_MIGRATION_STATE_ROOT;
    const barrierRoot = process.env.SWITCHYARD_MIGRATION_BARRIER_ROOT;
    const outputPath = process.env.SWITCHYARD_MIGRATION_OUTPUT;
    const scenario = process.env.SWITCHYARD_MIGRATION_SCENARIO;
    if (!stateRoot || !barrierRoot || !outputPath || !workerId || !scenario) {
      throw new Error("Missing concurrent migration worker configuration");
    }
    const waitForBothWorkers = (key: string) => {
      writeFileSync(join(barrierRoot, `ready-${workerId}-${key}`), "ready");
      const deadline = Date.now() + 5_000;
      while (
        !existsSync(join(barrierRoot, `ready-a-${key}`)) ||
        !existsSync(join(barrierRoot, `ready-b-${key}`))
      ) {
        if (Date.now() >= deadline) throw new Error("Migration barrier timed out");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    };

    if (scenario === "storage-open") {
      for (let index = 0; index < 30; index += 1) {
        const iterationRoot = join(stateRoot, `iteration-${index}`);
        mkdirSync(iterationRoot, { recursive: true });
        waitForBothWorkers(String(index));
        const store = SqliteStorage.open({ stateRoot: iterationRoot });
        store.close();
      }
      writeFileSync(outputPath, "ok");
      return;
    }

    waitForBothWorkers("migration");

    const database = new Database(join(stateRoot, "test.sqlite3"));
    database.pragma("busy_timeout = 5000");
    const pause = () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    };
    const testMigrations: readonly Migration[] = scenario === "fresh"
      ? [{
          version: 1,
          up(db) {
            db.exec(`
              CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
              );
              CREATE TABLE concurrent_fresh_marker (id INTEGER PRIMARY KEY);
            `);
            pause();
          }
        }]
      : [
          {
            version: 1,
            up() {
              throw new Error("Version 1 should already be applied");
            }
          },
          {
            version: 2,
            up(db) {
              db.exec("CREATE TABLE concurrent_v2_marker (id INTEGER PRIMARY KEY)");
              pause();
            }
          }
        ];
    try {
      migrateDatabase(database, "2026-08-27T00:00:00.000Z", testMigrations);
      writeFileSync(outputPath, "ok");
      expect(true).toBe(true);
    } finally {
      database.close();
    }
  }, 30_000);
});
