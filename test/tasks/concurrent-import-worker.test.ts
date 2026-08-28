import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteStorage } from "../../src/storage/sqlite.js";
import { TaskIntakeService } from "../../src/tasks/intake.js";

const workerId = process.env.SWITCHYARD_CONCURRENT_WORKER;

describe.skipIf(!workerId)("concurrent import worker", () => {
  it("imports after both processes reach the persistence boundary", async () => {
    const stateRoot = process.env.SWITCHYARD_CONCURRENT_STATE_ROOT;
    const intakeRoot = process.env.SWITCHYARD_CONCURRENT_INTAKE_ROOT;
    const barrierRoot = process.env.SWITCHYARD_CONCURRENT_BARRIER_ROOT;
    const outputPath = process.env.SWITCHYARD_CONCURRENT_OUTPUT;
    if (!stateRoot || !intakeRoot || !barrierRoot || !outputPath || !workerId) {
      throw new Error("Missing concurrent import worker configuration");
    }
    const store = SqliteStorage.open({ stateRoot });
    try {
      const service = new TaskIntakeService({
        storage: store,
        intakeRoot,
        idGenerator: () => {
          writeFileSync(join(barrierRoot, `ready-${workerId}`), "ready");
          const deadline = Date.now() + 5_000;
          while (
            !existsSync(join(barrierRoot, "ready-a")) ||
            !existsSync(join(barrierRoot, "ready-b"))
          ) {
            if (Date.now() >= deadline) throw new Error("Concurrent import barrier timed out");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
          return `concurrent-${workerId}`;
        }
      });
      const task = await service.import("task.md");
      writeFileSync(outputPath, JSON.stringify({
        id: task.id,
        sourceRevision: task.sourceRevision
      }));
      expect(task.sourceRevision).toBe(1);
    } finally {
      store.close();
    }
  });
});
