import type {
  CreateRepositoryInput,
  CreateTaskInput,
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
  createTask(input: CreateTaskInput): TaskRecord;
  getTask(id: string): TaskRecord | null;
  transitionTask(input: TransitionTaskInput): TaskRecord;
  eventsForTask(taskId: string): TaskEventRecord[];
}
