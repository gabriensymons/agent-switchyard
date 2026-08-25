import { z } from "zod";
import {
  providerIdentityIds,
  type ProviderIdentityId
} from "../config/provider-identities.js";
import {
  validateExactRepositoryPath,
  validatePolicyPathPattern
} from "./paths.js";

export const SYSTEM_MAXIMUM_LIMITS = {
  runtimeMinutes: 20,
  attempts: 2,
  changedFiles: 10,
  diffLines: 1_000,
  changedFileBytes: 256 * 1024,
  commandOutputBytes: 1024 * 1024
} as const;

export interface RepositoryLimits {
  runtimeMinutes: number;
  attempts: number;
  changedFiles: number;
  diffLines: number;
  changedFileBytes: number;
  commandOutputBytes: number;
}

export interface VerificationCommandPolicy {
  id: string;
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

export interface RepositoryPolicySnapshot {
  schemaVersion: 1;
  operatingMode: "local-only";
  allowedPaths: string[];
  forbiddenPaths: string[];
  providerIdentities: ProviderIdentityId[];
  verificationCommands: VerificationCommandPolicy[];
  limits: RepositoryLimits;
}

const commandIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const executableSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u);
const argumentSchema = z.string().min(1).max(512).refine(
  (value) =>
    !value.includes("\0") &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    !value.includes("${") &&
    !value.includes("$(") &&
    !value.includes("`") &&
    !/^~(?:[/\\]|$)/u.test(value) &&
    !/%[A-Za-z_][A-Za-z0-9_]*%/u.test(value),
  "Command arguments must be literal argv values"
);

const forbiddenExecutables = new Set([
  "ansible",
  "bash",
  "cmd",
  "csh",
  "curl",
  "dash",
  "doas",
  "docker",
  "env",
  "fish",
  "gh",
  "git",
  "kubectl",
  "powershell",
  "pwsh",
  "rsync",
  "scp",
  "sh",
  "ssh",
  "sudo",
  "tcsh",
  "terraform",
  "wget",
  "xargs",
  "zsh"
]);

const forbiddenCommandWords = new Set([
  "apply",
  "clean",
  "commit",
  "delete",
  "deploy",
  "destroy",
  "login",
  "logout",
  "merge",
  "publish",
  "push",
  "release",
  "reset"
]);

const verificationCommandSchema = z
  .object({
    id: commandIdSchema,
    executable: executableSchema,
    args: z.array(argumentSchema).max(32),
    cwd: z.string().min(1).max(256),
    timeoutMs: z.number().int().positive().max(20 * 60 * 1_000)
  })
  .strict()
  .superRefine((command, context) => {
    try {
      validateExactRepositoryPath(command.cwd);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["cwd"],
        message: "Command cwd must be a safe repository-relative path"
      });
    }
    const executable = command.executable.toLowerCase();
    if (forbiddenExecutables.has(executable)) {
      context.addIssue({
        code: "custom",
        path: ["executable"],
        message: "Command executable is outside the M1 verification boundary"
      });
    }
    if (
      executable === "node" &&
      command.args.some((argument) => argument === "-e" || argument === "--eval")
    ) {
      context.addIssue({
        code: "custom",
        path: ["args"],
        message: "Inline code execution is not a registered verification command"
      });
    }
    const words = command.args.flatMap((argument) =>
      argument.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean)
    );
    if (words.some((word) => forbiddenCommandWords.has(word))) {
      context.addIssue({
        code: "custom",
        path: ["args"],
        message: "Command argv requests a prohibited mutating operation"
      });
    }
  });

const limitsSchema = z
  .object({
    runtimeMinutes: z.number().int().positive().max(SYSTEM_MAXIMUM_LIMITS.runtimeMinutes),
    attempts: z.number().int().positive().max(SYSTEM_MAXIMUM_LIMITS.attempts),
    changedFiles: z.number().int().positive().max(SYSTEM_MAXIMUM_LIMITS.changedFiles),
    diffLines: z.number().int().positive().max(SYSTEM_MAXIMUM_LIMITS.diffLines),
    changedFileBytes: z.number().int().positive().max(SYSTEM_MAXIMUM_LIMITS.changedFileBytes),
    commandOutputBytes: z.number().int().positive().max(SYSTEM_MAXIMUM_LIMITS.commandOutputBytes)
  })
  .strict();

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const repositoryPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    operatingMode: z.literal("local-only"),
    allowedPaths: z.array(z.string()).min(1).max(50),
    forbiddenPaths: z.array(z.string()).max(50),
    providerIdentities: z.array(z.enum(providerIdentityIds)).min(1).max(
      providerIdentityIds.length
    ),
    verificationCommands: z.array(verificationCommandSchema).min(1).max(20),
    limits: limitsSchema
  })
  .strict()
  .superRefine((policy, context) => {
    for (const [index, path] of policy.allowedPaths.entries()) {
      try {
        validatePolicyPathPattern(path, "allowed");
      } catch {
        context.addIssue({
          code: "custom",
          path: ["allowedPaths", index],
          message: "Allowed path pattern is unsafe or unsupported"
        });
      }
    }
    for (const [index, path] of policy.forbiddenPaths.entries()) {
      try {
        validatePolicyPathPattern(path, "forbidden");
      } catch {
        context.addIssue({
          code: "custom",
          path: ["forbiddenPaths", index],
          message: "Forbidden path pattern is unsafe or unsupported"
        });
      }
    }
    if (!unique(policy.allowedPaths)) {
      context.addIssue({ code: "custom", path: ["allowedPaths"], message: "Allowed paths must be unique" });
    }
    if (!unique(policy.forbiddenPaths)) {
      context.addIssue({ code: "custom", path: ["forbiddenPaths"], message: "Forbidden paths must be unique" });
    }
    if (policy.allowedPaths.some((path) => policy.forbiddenPaths.includes(path))) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenPaths"],
        message: "The same path pattern cannot be both allowed and forbidden"
      });
    }
    if (!unique(policy.providerIdentities)) {
      context.addIssue({ code: "custom", path: ["providerIdentities"], message: "Provider identities must be unique" });
    }
    const commandIds = policy.verificationCommands.map((command) => command.id);
    if (!unique(commandIds)) {
      context.addIssue({ code: "custom", path: ["verificationCommands"], message: "Verification command IDs must be unique" });
    }
    const maximumTimeoutMs = policy.limits.runtimeMinutes * 60 * 1_000;
    for (const [index, command] of policy.verificationCommands.entries()) {
      if (command.timeoutMs > maximumTimeoutMs) {
        context.addIssue({
          code: "custom",
          path: ["verificationCommands", index, "timeoutMs"],
          message: "Command timeout exceeds the repository runtime limit"
        });
      }
    }
  });

export function parseRepositoryPolicy(value: unknown): RepositoryPolicySnapshot {
  return repositoryPolicySchema.parse(value) as RepositoryPolicySnapshot;
}
