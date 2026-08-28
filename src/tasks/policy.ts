import { z } from "zod";
import {
  providerIdentityIds,
  type ProviderIdentityId
} from "../config/provider-identities.js";
import {
  matchesPolicyPathPattern,
  repositoryPathIsAllowed,
  validateExactRepositoryPath,
  validatePolicyPathPattern
} from "../repositories/paths.js";
import {
  repositoryLimitsSchema,
  verificationCommandPolicySchema,
  type RepositoryLimits,
  type VerificationCommandPolicy
} from "../repositories/policy.js";
import type {
  RepositoryRecord,
  VersionedJsonObject
} from "../storage/types.js";
import type { ParsedTaskDocument } from "./document.js";
import { taskPolicyRejected } from "./errors.js";

export type ResolvedTaskLimits = VersionedJsonObject & RepositoryLimits & {
  schemaVersion: 1;
};

export type ResolvedRepositoryReference = {
  id: string;
  alias: string;
};

export type ResolvedTaskRequest = VersionedJsonObject & {
  schemaVersion: 1;
  kind: "resolved_task_request";
  repository: ResolvedRepositoryReference;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  providerIdentity: ProviderIdentityId;
  allowedPaths: string[];
  forbiddenPaths: string[];
  verificationCommands: VerificationCommandPolicy[];
  limits: ResolvedTaskLimits;
};

export type LegacyTaskRequest = VersionedJsonObject & {
  schemaVersion: 1;
  kind: "legacy_storage_record";
};

const resolvedTaskLimitsSchema = repositoryLimitsSchema.extend({
  schemaVersion: z.literal(1)
}).strict();
const resolvedTextSchema = z.string().trim().min(1);

const resolvedTaskRequestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("resolved_task_request"),
  repository: z.object({
    id: z.string().min(1),
    alias: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u)
  }).strict(),
  title: resolvedTextSchema,
  objective: resolvedTextSchema,
  acceptanceCriteria: z.array(resolvedTextSchema).min(1),
  providerIdentity: z.enum(providerIdentityIds),
  allowedPaths: z.array(z.string()).min(1),
  forbiddenPaths: z.array(z.string()),
  verificationCommands: z.array(verificationCommandPolicySchema).min(1),
  limits: resolvedTaskLimitsSchema
}).strict().superRefine((request, context) => {
  for (const [index, path] of request.allowedPaths.entries()) {
    try {
      if (path === ".") throw new Error("not a file path");
      validateExactRepositoryPath(path);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["allowedPaths", index],
        message: "Resolved allowed paths must be exact safe files"
      });
    }
  }
  for (const [index, pattern] of request.forbiddenPaths.entries()) {
    try {
      validatePolicyPathPattern(pattern, "forbidden");
    } catch {
      context.addIssue({
        code: "custom",
        path: ["forbiddenPaths", index],
        message: "Resolved forbidden paths must use repository policy syntax"
      });
    }
  }
  const caseFoldedPaths = request.allowedPaths.map((path) => path.toLowerCase());
  if (new Set(caseFoldedPaths).size !== caseFoldedPaths.length) {
    context.addIssue({
      code: "custom",
      path: ["allowedPaths"],
      message: "Resolved allowed paths must be case-insensitively unique"
    });
  }
  if (new Set(request.acceptanceCriteria).size !== request.acceptanceCriteria.length) {
    context.addIssue({
      code: "custom",
      path: ["acceptanceCriteria"],
      message: "Resolved acceptance criteria must be unique"
    });
  }
  const commandIds = request.verificationCommands.map((command) => command.id);
  if (new Set(commandIds).size !== commandIds.length) {
    context.addIssue({
      code: "custom",
      path: ["verificationCommands"],
      message: "Resolved verification commands must be unique"
    });
  }
  if (request.allowedPaths.some((candidate) =>
    request.forbiddenPaths.some((pattern) =>
      matchesPolicyPathPattern(pattern.toLowerCase(), candidate.toLowerCase())
    )
  )) {
    context.addIssue({
      code: "custom",
      path: ["allowedPaths"],
      message: "Resolved allowed paths overlap a forbidden path"
    });
  }
  if (request.verificationCommands.some((command) =>
    command.timeoutMs > request.limits.runtimeMinutes * 60 * 1_000
  )) {
    context.addIssue({
      code: "custom",
      path: ["verificationCommands"],
      message: "Resolved command timeout exceeds task runtime"
    });
  }
});

const legacyTaskRequestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("legacy_storage_record")
}).strict();

export function parseResolvedTaskRequest(value: unknown): ResolvedTaskRequest {
  return resolvedTaskRequestSchema.parse(value) as ResolvedTaskRequest;
}

export function parseStoredTaskRequest(
  value: unknown
): ResolvedTaskRequest | LegacyTaskRequest {
  return z.union([
    resolvedTaskRequestSchema,
    legacyTaskRequestSchema
  ]).parse(value) as ResolvedTaskRequest | LegacyTaskRequest;
}

const limitNames = [
  "runtimeMinutes",
  "attempts",
  "changedFiles",
  "diffLines",
  "changedFileBytes",
  "commandOutputBytes"
] as const satisfies readonly (keyof RepositoryLimits)[];


function freezeResolvedRequest(request: ResolvedTaskRequest): ResolvedTaskRequest {
  Object.freeze(request.repository);
  Object.freeze(request.acceptanceCriteria);
  Object.freeze(request.allowedPaths);
  Object.freeze(request.forbiddenPaths);
  for (const command of request.verificationCommands) {
    Object.freeze(command.args);
    Object.freeze(command);
  }
  Object.freeze(request.verificationCommands);
  Object.freeze(request.limits);
  return Object.freeze(request);
}

export function resolveTaskRequest(
  document: ParsedTaskDocument,
  repository: RepositoryRecord
): ResolvedTaskRequest {
  const policy = repository.policy;
  if (!policy.providerIdentities.includes(document.providerIdentity)) {
    throw taskPolicyRejected();
  }
  const caseFoldedPaths = document.allowedPaths.map((path) => path.toLowerCase());
  if (new Set(caseFoldedPaths).size !== caseFoldedPaths.length) {
    throw taskPolicyRejected();
  }
  if (document.allowedPaths.some((candidate) =>
    !repositoryPathIsAllowed(
      policy.allowedPaths,
      policy.forbiddenPaths,
      candidate
    ) || policy.forbiddenPaths.some((pattern) =>
      matchesPolicyPathPattern(pattern.toLowerCase(), candidate.toLowerCase())
    )
  )) {
    throw taskPolicyRejected();
  }

  const commandsById = new Map(
    policy.verificationCommands.map((command) => [command.id, command])
  );
  const verificationCommands = document.verification.map((id) => {
    const command = commandsById.get(id);
    if (!command) throw taskPolicyRejected();
    return { ...command, args: [...command.args] };
  });

  const resolvedLimits = Object.fromEntries(limitNames.map((name) => {
    const requested = document.limits?.[name] ?? policy.limits[name];
    if (requested > policy.limits[name]) throw taskPolicyRejected();
    return [name, requested];
  })) as unknown as RepositoryLimits;
  if (verificationCommands.some((command) =>
    command.timeoutMs > resolvedLimits.runtimeMinutes * 60 * 1_000
  )) {
    throw taskPolicyRejected();
  }

  const request: ResolvedTaskRequest = {
    schemaVersion: 1,
    kind: "resolved_task_request",
    repository: { id: repository.id, alias: repository.alias },
    title: document.title,
    objective: document.objective,
    acceptanceCriteria: [...document.acceptanceCriteria],
    providerIdentity: document.providerIdentity,
    allowedPaths: [...document.allowedPaths],
    forbiddenPaths: [...policy.forbiddenPaths],
    verificationCommands,
    limits: { schemaVersion: 1, ...resolvedLimits }
  };
  return freezeResolvedRequest(request);
}
