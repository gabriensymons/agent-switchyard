import type {
  CreateRepositoryInput,
  CreateTaskInput,
  ImportTaskInput,
  RepositoryRecord,
  TaskEventRecord,
  TaskRecord,
  TransitionTaskInput
} from "./types.js";

export interface SwitchyardStorage {
  close(): void;
  diagnostics(): {
    journalMode: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
  };
  createRepository(input: CreateRepositoryInput): RepositoryRecord;
  getRepository(id: string): RepositoryRecord | null;
  getRepositoryByAlias(alias: string): RepositoryRecord | null;
  listRepositories(): RepositoryRecord[];
  createTask(input: CreateTaskInput): TaskRecord;
  importTask(input: ImportTaskInput): TaskRecord;
  getTask(id: string): TaskRecord | null;
  getTaskBySourceHash(sourceIdentity: string, sourceHash: string): TaskRecord | null;
  transitionTask(input: TransitionTaskInput): TaskRecord;
  eventsForTask(taskId: string): TaskEventRecord[];
}
