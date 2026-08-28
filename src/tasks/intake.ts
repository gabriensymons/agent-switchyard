import { randomUUID } from "node:crypto";
import type { SwitchyardStorage } from "../storage/storage.js";
import type { TaskRecord } from "../storage/types.js";
import { parseTaskDocument } from "./document.js";
import { TaskIntakeError, taskPolicyRejected } from "./errors.js";
import { resolveTaskRequest } from "./policy.js";
import { readTaskSource } from "./source.js";

export interface TaskIntakeServiceOptions {
  storage: SwitchyardStorage;
  intakeRoot: string;
  idGenerator?: () => string;
  now?: () => Date;
  actor?: string;
}


function storageConflict(): TaskIntakeError {
  return new TaskIntakeError(
    "storage_conflict",
    "Task intake could not establish a unique durable source revision"
  );
}

export class TaskIntakeService {
  constructor(private readonly options: TaskIntakeServiceOptions) {}

  async import(sourcePath: string): Promise<TaskRecord> {
    const source = await readTaskSource({
      intakeRoot: this.options.intakeRoot,
      sourcePath
    });
    const document = parseTaskDocument(source.bytes);
    const sourceIdentity = document.id
      ? `id:${document.id}`
      : `path:${source.canonicalPath}`;

    let existing: TaskRecord | null;
    try {
      existing = this.options.storage.getTaskBySourceHash(
        sourceIdentity,
        source.sourceHash
      );
    } catch {
      throw storageConflict();
    }
    if (existing) return existing;

    let repository;
    try {
      repository = this.options.storage.getRepositoryByAlias(document.repository);
    } catch {
      throw storageConflict();
    }
    if (!repository) throw taskPolicyRejected();
    const request = resolveTaskRequest(document, repository);
    const at = (this.options.now ?? (() => new Date()))().toISOString();

    try {
      return this.options.storage.importTask({
        id: (this.options.idGenerator ?? randomUUID)(),
        schemaVersion: document.schemaVersion,
        sourcePath: source.canonicalPath,
        sourceIdentity,
        sourceHash: source.sourceHash,
        repositoryId: repository.id,
        title: document.title,
        objective: document.objective,
        state: "ingested",
        limits: request.limits,
        request,
        createdAt: at,
        updatedAt: at,
        actor: this.options.actor ?? "switchyard",
        eventPayload: {
          schemaVersion: 1,
          sourceIdentity,
          sourceHash: source.sourceHash,
          repositoryId: repository.id
        }
      });
    } catch {
      throw storageConflict();
    }
  }
}
