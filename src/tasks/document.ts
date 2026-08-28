import { TextDecoder } from "node:util";
import { isScalar, parseDocument, visit } from "yaml";
import { z } from "zod";
import { providerIdentityIds } from "../config/provider-identities.js";
import { validateExactRepositoryPath } from "../repositories/paths.js";
import { TaskIntakeError } from "./errors.js";

export const MAX_TASK_DOCUMENT_BYTES = 64 * 1024;

const boundedText = z.string().trim().min(1);
const sourceId = z.string().trim().min(1).refine(
  (value) => !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  }),
  "Task source IDs cannot contain control characters"
);
const repositoryAlias = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const verificationId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
const taskLimitsSchema = z.object({
  runtimeMinutes: z.number().int().positive(),
  attempts: z.number().int().positive(),
  changedFiles: z.number().int().positive(),
  diffLines: z.number().int().positive(),
  changedFileBytes: z.number().int().positive(),
  commandOutputBytes: z.number().int().positive()
}).strict();

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const taskFrontmatterSchema = z.object({
  schemaVersion: z.literal(1),
  id: sourceId.optional(),
  title: boundedText,
  repository: repositoryAlias,
  providerIdentity: z.enum(providerIdentityIds),
  allowedPaths: z.array(z.string()).min(1),
  verification: z.array(verificationId).min(1),
  limits: taskLimitsSchema.optional(),
  acceptanceCriteria: z.array(boundedText).min(1)
}).strict().superRefine((value, context) => {
  for (const [index, path] of value.allowedPaths.entries()) {
    try {
      if (path === ".") throw new Error("not a file path");
      validateExactRepositoryPath(path);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["allowedPaths", index],
        message: "Allowed paths must be concrete safe repository-relative files"
      });
    }
  }
  for (const [field, values] of [
    ["allowedPaths", value.allowedPaths],
    ["verification", value.verification],
    ["acceptanceCriteria", value.acceptanceCriteria]
  ] as const) {
    if (!unique(values)) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} values must be unique`
      });
    }
  }
});

type TaskFrontmatter = z.infer<typeof taskFrontmatterSchema>;

export interface ParsedTaskDocument extends TaskFrontmatter {
  objective: string;
}

function invalidDocument(): TaskIntakeError {
  return new TaskIntakeError(
    "invalid_input",
    "Task document does not match the strict version-1 Markdown/YAML contract"
  );
}

function decodeTaskBytes(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_TASK_DOCUMENT_BYTES) throw invalidDocument();
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw invalidDocument();
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidDocument();
  }
}

function splitFrontmatter(text: string): {
  yaml: string;
  objective: string;
} {
  const lines = text.split(/\r?\n/u);
  if (lines[0] !== "---") throw invalidDocument();
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) throw invalidDocument();
  const yaml = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  if (/^\s*---\n[\s\S]*?\n---(?:\n|$)/u.test(body)) {
    throw invalidDocument();
  }
  const objective = body.trim();
  if (objective.length === 0) throw invalidDocument();
  return { yaml, objective };
}

function parseStrictYaml(source: string): unknown {
  if (/^(?:%YAML|%TAG)\b/mu.test(source)) throw invalidDocument();
  const document = parseDocument(source, {
    version: "1.2",
    schema: "core",
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    merge: false,
    resolveKnownTags: false
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw invalidDocument();
  }

  let forbiddenFeature = false;
  visit(document, {
    Alias() {
      forbiddenFeature = true;
      return visit.BREAK;
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && pair.key.value === "<<") {
        forbiddenFeature = true;
        return visit.BREAK;
      }
      return undefined;
    },
    Value(_key, node) {
      if (node.anchor || node.tag) {
        forbiddenFeature = true;
        return visit.BREAK;
      }
      return undefined;
    }
  });
  if (forbiddenFeature) throw invalidDocument();

  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch {
    throw invalidDocument();
  }
}

export function parseTaskDocument(bytes: Uint8Array): ParsedTaskDocument {
  try {
    const { yaml, objective } = splitFrontmatter(decodeTaskBytes(bytes));
    const frontmatter = taskFrontmatterSchema.parse(parseStrictYaml(yaml));
    return { ...frontmatter, objective };
  } catch (error) {
    if (error instanceof TaskIntakeError) throw error;
    throw invalidDocument();
  }
}
