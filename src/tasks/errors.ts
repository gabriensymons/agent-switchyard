export type TaskIntakeErrorCode =
  | "invalid_input"
  | "policy_rejected"
  | "source_file_unsafe"
  | "storage_conflict";

export class TaskIntakeError extends Error {
  readonly code: TaskIntakeErrorCode;

  constructor(code: TaskIntakeErrorCode, message: string) {
    super(message);
    this.name = "TaskIntakeError";
    this.code = code;
  }
}

export function taskPolicyRejected(): TaskIntakeError {
  return new TaskIntakeError(
    "policy_rejected",
    "Task does not satisfy the registered repository policy"
  );
}
