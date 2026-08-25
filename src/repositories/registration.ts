import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { parse, resolve } from "node:path";
import type { GitRepositoryInspector } from "../git/repository-inspector.js";
import type { SwitchyardStorage } from "../storage/storage.js";
import type { RepositoryRecord } from "../storage/types.js";
import { RepositoryRegistrationError } from "./errors.js";
import { pathsOverlap } from "./paths.js";
import {
  parseRepositoryPolicy,
  type RepositoryPolicySnapshot
} from "./policy.js";

const repositoryAlias = /^[a-z][a-z0-9-]{0,63}$/u;

export interface RegisterRepositoryInput {
  alias: string;
  repositoryPath: string;
  worktreeRoot: string;
  defaultBranch: string;
  policy: unknown;
}

export interface RepositoryRegistrationOptions {
  storage: SwitchyardStorage;
  gitInspector: GitRepositoryInspector;
  stateRoot: string;
  intakeRoot?: string;
  protectedRoots?: readonly string[];
  idGenerator?: () => string;
  now?: () => Date;
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
  if (path.trim().length === 0) {
    throw new RepositoryRegistrationError(
      "path_invalid",
      `${label} must be a non-empty existing directory`
    );
  }
  const lexical = resolve(path);
  const metadata = await lstat(lexical).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw new RepositoryRegistrationError(
      "path_invalid",
      `${label} must be a non-symbolic-link directory`
    );
  }
  const canonical = await realpath(lexical).catch(() => "");
  if (canonical.length === 0 || canonical !== lexical) {
    throw new RepositoryRegistrationError(
      "path_invalid",
      `${label} must be provided as its canonical real path`
    );
  }
  return canonical;
}

async function canonicalProtectionPath(path: string): Promise<string> {
  const lexical = resolve(path);
  return await realpath(lexical).catch(() => lexical);
}

function assertNotBroadRoot(path: string, home: string, label: string): void {
  if (path === parse(path).root || path === home) {
    throw new RepositoryRegistrationError(
      "path_invalid",
      `${label} cannot be a filesystem root or home directory`
    );
  }
}

function assertNoOverlap(
  left: string,
  right: string,
  message: string
): void {
  if (pathsOverlap(left, right)) {
    throw new RepositoryRegistrationError("path_overlap", message);
  }
}

async function protectedPaths(options: RepositoryRegistrationOptions): Promise<string[]> {
  const home = resolve(homedir());
  const configured = [
    options.stateRoot,
    ...(options.intakeRoot ? [options.intakeRoot] : []),
    resolve(home, ".agent-switchyard"),
    resolve(home, ".aws"),
    resolve(home, ".azure"),
    resolve(home, ".claude"),
    resolve(home, ".codex"),
    resolve(home, ".config"),
    resolve(home, ".docker"),
    resolve(home, ".gnupg"),
    resolve(home, ".kube"),
    resolve(home, ".local", "share", "keyrings"),
    resolve(home, ".npm"),
    resolve(home, ".ssh"),
    resolve(home, "Library", "Keychains"),
    ...(options.protectedRoots ?? [])
  ];
  return await Promise.all(configured.map(canonicalProtectionPath));
}

function assertNoRegisteredOverlap(
  canonicalRoot: string,
  worktreeRoot: string,
  repositories: readonly RepositoryRecord[]
): void {
  for (const repository of repositories) {
    assertNoOverlap(
      canonicalRoot,
      repository.canonicalRoot,
      "Registered repositories cannot be nested or overlap"
    );
    assertNoOverlap(
      canonicalRoot,
      repository.worktreeRoot,
      "Repository root overlaps a registered worktree root"
    );
    assertNoOverlap(
      worktreeRoot,
      repository.canonicalRoot,
      "Worktree root overlaps a registered repository"
    );
    assertNoOverlap(
      worktreeRoot,
      repository.worktreeRoot,
      "Registered worktree roots cannot overlap"
    );
  }
}

export class RepositoryRegistrationService {
  constructor(private readonly options: RepositoryRegistrationOptions) {}

  async register(input: RegisterRepositoryInput): Promise<RepositoryRecord> {
    if (!repositoryAlias.test(input.alias)) {
      throw new RepositoryRegistrationError(
        "policy_invalid",
        "Repository alias must use lowercase letters, digits, and hyphens"
      );
    }
    if (this.options.storage.getRepositoryByAlias(input.alias)) {
      throw new RepositoryRegistrationError(
        "alias_conflict",
        "Repository alias is already registered"
      );
    }

    let policy: RepositoryPolicySnapshot;
    try {
      policy = parseRepositoryPolicy(input.policy);
    } catch {
      throw new RepositoryRegistrationError(
        "policy_invalid",
        "Repository policy does not match the supported schema"
      );
    }

    const [canonicalRoot, worktreeRoot, home, protectedRoots] = await Promise.all([
      canonicalDirectory(input.repositoryPath, "Repository root"),
      canonicalDirectory(input.worktreeRoot, "Worktree root"),
      canonicalProtectionPath(homedir()),
      protectedPaths(this.options)
    ]);
    assertNotBroadRoot(canonicalRoot, home, "Repository root");
    assertNotBroadRoot(worktreeRoot, home, "Worktree root");
    assertNoOverlap(
      canonicalRoot,
      worktreeRoot,
      "Repository and worktree roots must be separate"
    );
    for (const protectedRoot of protectedRoots) {
      assertNoOverlap(
        canonicalRoot,
        protectedRoot,
        "Repository root overlaps Switchyard, credential, or configuration state"
      );
      assertNoOverlap(
        worktreeRoot,
        protectedRoot,
        "Worktree root overlaps Switchyard, credential, or configuration state"
      );
    }
    assertNoRegisteredOverlap(
      canonicalRoot,
      worktreeRoot,
      this.options.storage.listRepositories()
    );

    await this.options.gitInspector.assertWorktreeContainer(worktreeRoot);
    await this.options.gitInspector.inspect(canonicalRoot, input.defaultBranch);
    const at = (this.options.now ?? (() => new Date()))().toISOString();
    return this.options.storage.createRepository({
      id: (this.options.idGenerator ?? randomUUID)(),
      alias: input.alias,
      canonicalRoot,
      worktreeRoot,
      defaultBranch: input.defaultBranch,
      policy,
      createdAt: at,
      updatedAt: at
    });
  }
}
