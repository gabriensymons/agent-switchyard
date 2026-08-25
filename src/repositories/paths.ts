import { isAbsolute, relative, sep } from "node:path";

const MAX_POLICY_PATH_LENGTH = 256;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/u;
const UNSUPPORTED_GLOB_CHARACTERS = /[?[\]{}!()]/u;
const PORTABLE_SEGMENT = /^[A-Za-z0-9._@+ *-]+$/u;

const protectedSegments = new Set([
  ".agent-switchyard",
  ".aws",
  ".azure",
  ".claude",
  ".codex",
  ".config",
  ".docker",
  ".git",
  ".github",
  ".gnupg",
  ".kube",
  ".npm",
  ".ssh"
]);

const protectedBasenames = new Set([
  ".netrc",
  ".npmrc",
  ".pypirc",
  "cargo.toml",
  "credentials",
  "dockerfile",
  "gemfile",
  "id_ed25519",
  "id_rsa",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pyproject.toml",
  "secring.gpg",
  "yarn.lock"
]);

const protectedDirectorySegments = new Set([
  "deploy",
  "deployment",
  "helm",
  "k8s",
  "terraform"
]);

const signingExtensions = [".key", ".p12", ".pem", ".pfx"];

export type PolicyPathKind = "allowed" | "forbidden";

export function validatePolicyPathPattern(
  value: string,
  kind: PolicyPathKind
): string {
  if (
    value.length === 0 ||
    value.length > MAX_POLICY_PATH_LENGTH ||
    value.trim() !== value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    WINDOWS_DRIVE_PREFIX.test(value) ||
    UNSUPPORTED_GLOB_CHARACTERS.test(value)
  ) {
    throw new Error("Path policy entries must use bounded relative POSIX syntax");
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.trim() !== segment ||
        segment === "." ||
        segment === ".." ||
        !PORTABLE_SEGMENT.test(segment) ||
        (segment.includes("**") && segment !== "**")
    ) ||
    segments[0]?.includes("*")
  ) {
    throw new Error("Path policy entries contain unsupported or ambiguous segments");
  }

  if (kind === "allowed" && isSystemProtectedPolicyPath(value)) {
    throw new Error("Allowed path policy overlaps a protected path");
  }
  return value;
}

export function validateExactRepositoryPath(value: string): string {
  if (value === ".") return value;
  const validated = validatePolicyPathPattern(value, "forbidden");
  if (validated.includes("*")) {
    throw new Error("Repository path must not contain glob syntax");
  }
  if (isSystemProtectedPolicyPath(validated)) {
    throw new Error("Repository path overlaps a protected path");
  }
  return validated;
}

export function isSystemProtectedPolicyPath(value: string): boolean {
  const segments = value.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  if (
    segments.some(
      (segment) =>
        protectedSegments.has(segment) ||
        protectedDirectorySegments.has(segment)
    )
  ) {
    return true;
  }
  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "secrets" ||
    basename.startsWith("secrets.") ||
    basename.startsWith("credentials.") ||
    protectedBasenames.has(basename) ||
    signingExtensions.some((extension) => basename.endsWith(extension)) ||
    basename.startsWith("docker-compose.")
  );
}

function segmentMatches(pattern: string, candidate: string): boolean {
  const rows = pattern.length + 1;
  const columns = candidate.length + 1;
  const matches = Array.from(
    { length: rows },
    () => Array<boolean>(columns).fill(false)
  );
  matches[0]![0] = true;
  for (let patternIndex = 1; patternIndex < rows; patternIndex += 1) {
    const patternCharacter = pattern[patternIndex - 1];
    if (patternCharacter === "*") {
      matches[patternIndex]![0] = matches[patternIndex - 1]![0] ?? false;
    }
    for (let candidateIndex = 1; candidateIndex < columns; candidateIndex += 1) {
      const candidateCharacter = candidate[candidateIndex - 1];
      matches[patternIndex]![candidateIndex] =
        patternCharacter === "*"
          ? Boolean(
              matches[patternIndex - 1]![candidateIndex] ||
              matches[patternIndex]![candidateIndex - 1]
            )
          : patternCharacter === candidateCharacter &&
            Boolean(matches[patternIndex - 1]![candidateIndex - 1]);
    }
  }
  return matches[pattern.length]![candidate.length] ?? false;
}

export function matchesPolicyPathPattern(
  pattern: string,
  candidate: string
): boolean {
  const patternSegments = pattern.split("/");
  const candidateSegments = candidate.split("/");
  const memo = new Map<string, boolean>();

  const matchesFrom = (patternIndex: number, candidateIndex: number): boolean => {
    const key = `${patternIndex}:${candidateIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (patternIndex === patternSegments.length) {
      result = candidateIndex === candidateSegments.length;
    } else if (patternSegments[patternIndex] === "**") {
      result =
        matchesFrom(patternIndex + 1, candidateIndex) ||
        (candidateIndex < candidateSegments.length &&
          matchesFrom(patternIndex, candidateIndex + 1));
    } else {
      result =
        candidateIndex < candidateSegments.length &&
        segmentMatches(
          patternSegments[patternIndex] ?? "",
          candidateSegments[candidateIndex] ?? ""
        ) &&
        matchesFrom(patternIndex + 1, candidateIndex + 1);
    }
    memo.set(key, result);
    return result;
  };

  return matchesFrom(0, 0);
}

export function repositoryPathIsAllowed(
  allowedPatterns: readonly string[],
  forbiddenPatterns: readonly string[],
  candidate: string
): boolean {
  let normalized: string;
  try {
    normalized = validateExactRepositoryPath(candidate);
  } catch {
    return false;
  }
  return (
    allowedPatterns.some((pattern) =>
      matchesPolicyPathPattern(pattern, normalized)
    ) &&
    !forbiddenPatterns.some((pattern) =>
      matchesPolicyPathPattern(pattern, normalized)
    )
  );
}

export function pathIsWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

export function pathsOverlap(left: string, right: string): boolean {
  return pathIsWithin(left, right) || pathIsWithin(right, left);
}
