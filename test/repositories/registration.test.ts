import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { SpawnCommandRunner } from "../../src/core/command-runner.js";
import { GitRepositoryInspector } from "../../src/git/repository-inspector.js";
import { RepositoryRegistrationService } from "../../src/repositories/registration.js";
import { SYSTEM_MAXIMUM_LIMITS } from "../../src/repositories/policy.js";
import { SqliteStorage } from "../../src/storage/sqlite.js";

const executeFile = promisify(execFile);
const temporaryRoots: string[] = [];
const openStores: SqliteStorage[] = [];

async function temporaryRoot(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "switchyard-registration-"));
  const canonical = await realpath(created);
  temporaryRoots.push(canonical);
  return canonical;
}

async function gitRepository(parent: string, name: string): Promise<string> {
  const root = join(parent, name);
  await mkdir(root, { recursive: true });
  await executeFile("git", ["init", "--initial-branch=main", root]);
  await executeFile("git", ["-C", root, "config", "user.name", "Fixture"]);
  await executeFile("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(root, "README.md"), "fixture\n", "utf8");
  await executeFile("git", ["-C", root, "add", "README.md"]);
  await executeFile("git", ["-C", root, "commit", "-m", "fixture"]);
  return root;
}

function policy(): unknown {
  return {
    schemaVersion: 1,
    operatingMode: "local-only",
    allowedPaths: ["src/**", "test/**"],
    forbiddenPaths: ["generated/**"],
    providerIdentities: ["codex-isolated"],
    verificationCommands: [
      {
        id: "test-targeted",
        executable: "npm",
        args: ["test"],
        cwd: ".",
        timeoutMs: 60_000
      }
    ],
    limits: { ...SYSTEM_MAXIMUM_LIMITS }
  };
}

async function fixture(): Promise<{
  parent: string;
  repositoryRoot: string;
  worktreeRoot: string;
  stateRoot: string;
  storage: SqliteStorage;
  service: RepositoryRegistrationService;
}> {
  const parent = await temporaryRoot();
  const repositoryRoot = await gitRepository(parent, "repository");
  const worktreeRoot = join(parent, "worktrees");
  const stateRoot = join(parent, "state");
  await mkdir(worktreeRoot);
  const storage = SqliteStorage.open({ stateRoot });
  openStores.push(storage);
  const service = new RepositoryRegistrationService({
    storage,
    gitInspector: new GitRepositoryInspector({ runner: new SpawnCommandRunner() }),
    stateRoot,
    idGenerator: () => "repository-1",
    now: () => new Date("2026-08-25T00:00:00.000Z")
  });
  return { parent, repositoryRoot, worktreeRoot, stateRoot, storage, service };
}

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    try {
      store.close();
    } catch {
      // A test may close the store before reopening it.
    }
  }
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) =>
      await rm(root, { recursive: true, force: true })
    )
  );
});

describe("RepositoryRegistrationService", () => {
  it("validates, persists, resolves, lists, and reopens a repository", async () => {
    const { repositoryRoot, worktreeRoot, stateRoot, storage, service } =
      await fixture();
    const beforeHead = (await executeFile("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]))
      .stdout.trim();
    const registered = await service.register({
      alias: "fixture-repo",
      repositoryPath: repositoryRoot,
      worktreeRoot,
      defaultBranch: "main",
      policy: policy()
    });

    expect(registered).toMatchObject({
      id: "repository-1",
      alias: "fixture-repo",
      canonicalRoot: repositoryRoot,
      worktreeRoot,
      defaultBranch: "main"
    });
    expect(storage.getRepositoryByAlias("fixture-repo")).toEqual(registered);
    expect(storage.listRepositories()).toEqual([registered]);
    expect(
      (await executeFile("git", ["-C", repositoryRoot, "status", "--porcelain=v1"]))
        .stdout
    ).toBe("");
    expect(
      (await executeFile("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]))
        .stdout.trim()
    ).toBe(beforeHead);

    storage.close();
    const reopened = SqliteStorage.open({ stateRoot });
    openStores.push(reopened);
    expect(reopened.getRepositoryByAlias("fixture-repo")).toEqual(registered);
  });

  it("rejects a non-Git directory and a missing default branch", async () => {
    const { parent, worktreeRoot, service } = await fixture();
    const nonGit = join(parent, "not-git");
    await mkdir(nonGit);
    await expect(
      service.register({
        alias: "not-git",
        repositoryPath: nonGit,
        worktreeRoot,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "git_invalid" });

    const secondWorktreeRoot = join(parent, "other-worktrees");
    await mkdir(secondWorktreeRoot);
    const otherRepository = await gitRepository(parent, "other-repository");
    await expect(
      service.register({
        alias: "wrong-branch",
        repositoryPath: otherRepository,
        worktreeRoot: secondWorktreeRoot,
        defaultBranch: "missing",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "default_branch_invalid" });
  });

  it("rejects symbolic-link roots", async () => {
    if (process.platform === "win32") return;
    const { parent, repositoryRoot, worktreeRoot, service } = await fixture();
    const repositoryLink = join(parent, "repository-link");
    await symlink(repositoryRoot, repositoryLink);

    await expect(
      service.register({
        alias: "linked-repo",
        repositoryPath: repositoryLink,
        worktreeRoot,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_invalid" });
  });

  it("rejects repository/worktree and protected-root overlap", async () => {
    const { parent, repositoryRoot, stateRoot, storage } = await fixture();
    const insideRepository = join(repositoryRoot, "worktrees");
    await mkdir(insideRepository);
    const inspector = new GitRepositoryInspector({ runner: new SpawnCommandRunner() });
    const overlapping = new RepositoryRegistrationService({
      storage,
      gitInspector: inspector,
      stateRoot
    });
    await expect(
      overlapping.register({
        alias: "overlap",
        repositoryPath: repositoryRoot,
        worktreeRoot: insideRepository,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_overlap" });

    const protectedDirectory = join(repositoryRoot, "private-config");
    await mkdir(protectedDirectory);
    const externalWorktrees = join(parent, "external-worktrees");
    await mkdir(externalWorktrees);
    const protectedService = new RepositoryRegistrationService({
      storage,
      gitInspector: inspector,
      stateRoot,
      protectedRoots: [protectedDirectory]
    });
    await expect(
      protectedService.register({
        alias: "protected",
        repositoryPath: repositoryRoot,
        worktreeRoot: externalWorktrees,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_overlap" });
  });

  it("rejects filesystem roots, home, and a worktree container inside Git", async () => {
    const { parent, repositoryRoot, stateRoot, storage } = await fixture();
    const inspector = new GitRepositoryInspector({ runner: new SpawnCommandRunner() });
    const service = new RepositoryRegistrationService({
      storage,
      gitInspector: inspector,
      stateRoot
    });
    await expect(
      service.register({
        alias: "filesystem-root",
        repositoryPath: "/",
        worktreeRoot: join(parent, "worktrees"),
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_invalid" });
    await expect(
      service.register({
        alias: "home-root",
        repositoryPath: await realpath(homedir()),
        worktreeRoot: join(parent, "worktrees"),
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_invalid" });

    const repositoryAsWorktreeRoot = await gitRepository(parent, "worktree-repository");
    await expect(
      service.register({
        alias: "git-worktrees",
        repositoryPath: repositoryRoot,
        worktreeRoot: repositoryAsWorktreeRoot,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_overlap" });
  });

  it("rejects nested repositories and duplicate aliases before persistence", async () => {
    const { repositoryRoot, worktreeRoot, stateRoot, storage, service } =
      await fixture();
    await service.register({
      alias: "fixture-repo",
      repositoryPath: repositoryRoot,
      worktreeRoot,
      defaultBranch: "main",
      policy: policy()
    });
    await expect(
      service.register({
        alias: "fixture-repo",
        repositoryPath: repositoryRoot,
        worktreeRoot,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "alias_conflict" });

    const nested = await gitRepository(repositoryRoot, "nested");
    const nestedWorktrees = join(repositoryRoot, "..", "nested-worktrees");
    await mkdir(nestedWorktrees);
    const nestedService = new RepositoryRegistrationService({
      storage,
      gitInspector: new GitRepositoryInspector({ runner: new SpawnCommandRunner() }),
      stateRoot,
      idGenerator: () => "repository-2"
    });
    await expect(
      nestedService.register({
        alias: "nested",
        repositoryPath: nested,
        worktreeRoot: nestedWorktrees,
        defaultBranch: "main",
        policy: policy()
      })
    ).rejects.toMatchObject({ code: "path_overlap" });
    expect(storage.listRepositories()).toHaveLength(1);
  });

  it("rejects unsupported policy before any repository record is written", async () => {
    const { repositoryRoot, worktreeRoot, storage, service } = await fixture();
    await expect(
      service.register({
        alias: "unsafe",
        repositoryPath: repositoryRoot,
        worktreeRoot,
        defaultBranch: "main",
        policy: { schemaVersion: 1, allowedPaths: ["**"] }
      })
    ).rejects.toMatchObject({ code: "policy_invalid" });
    expect(storage.listRepositories()).toEqual([]);
  });
});
