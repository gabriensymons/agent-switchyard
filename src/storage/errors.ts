export type StorageErrorCode =
  | "constraint_violation"
  | "invalid_transition"
  | "migration_failed"
  | "not_found"
  | "open_failed"
  | "read_failed"
  | "schema_incompatible"
  | "stale_revision"
  | "write_failed";

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

interface ErrorWithCode {
  code?: unknown;
}

export function normalizeStorageError(
  error: unknown,
  operation: "open" | "read" | "write"
): StorageError {
  if (error instanceof StorageError) return error;
  const code = (error as ErrorWithCode | null)?.code;
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT")) {
    return new StorageError(
      "constraint_violation",
      "Storage rejected data that violates an integrity constraint"
    );
  }
  const normalizedCode =
    operation === "open"
      ? "open_failed"
      : operation === "read"
        ? "read_failed"
        : "write_failed";
  return new StorageError(
    normalizedCode,
    `Switchyard storage ${operation} failed`
  );
}
