export type RepositoryRegistrationErrorCode =
  | "alias_conflict"
  | "default_branch_invalid"
  | "git_invalid"
  | "path_invalid"
  | "path_overlap"
  | "policy_invalid";

export class RepositoryRegistrationError extends Error {
  readonly code: RepositoryRegistrationErrorCode;

  constructor(code: RepositoryRegistrationErrorCode, message: string) {
    super(message);
    this.name = "RepositoryRegistrationError";
    this.code = code;
  }
}
