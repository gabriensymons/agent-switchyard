import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRunner } from "../core/command-runner.js";
import { RepositoryRegistrationError } from "../repositories/errors.js";

export interface GitRepositoryInspection {
  canonicalRoot: string;
  defaultBranch: string;
}

export interface GitRepositoryInspectorOptions {
  runner: CommandRunner;
  timeoutMs?: number;
}

export class GitRepositoryInspector {
  private readonly timeoutMs: number;

  constructor(private readonly options: GitRepositoryInspectorOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async assertWorktreeContainer(path: string): Promise<void> {
    const result = await this.options.runner.run({
      command: "git",
      args: ["-C", path, "rev-parse", "--show-toplevel"],
      cwd: path,
      timeoutMs: this.timeoutMs
    });
    if (result.exitCode === 0) {
      throw new RepositoryRegistrationError(
        "path_overlap",
        "Worktree root must not be inside any Git worktree"
      );
    }
  }

  async inspect(
    canonicalRoot: string,
    defaultBranch: string
  ): Promise<GitRepositoryInspection> {
    if (
      defaultBranch.length === 0 ||
      defaultBranch.length > 255 ||
      defaultBranch.trim() !== defaultBranch ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(defaultBranch)
    ) {
      throw new RepositoryRegistrationError(
        "default_branch_invalid",
        "Repository default branch is invalid"
      );
    }

    const gitMarker = await lstat(join(canonicalRoot, ".git")).catch(() => null);
    if (!gitMarker?.isDirectory()) {
      throw new RepositoryRegistrationError(
        "git_invalid",
        "Repository must be a primary non-bare Git worktree"
      );
    }

    const run = async (args: string[]) =>
      await this.options.runner.run({
        command: "git",
        args: ["-C", canonicalRoot, ...args],
        cwd: canonicalRoot,
        timeoutMs: this.timeoutMs
      });

    const [rootResult, bareResult, branchFormatResult, branchResult] =
      await Promise.all([
        run(["rev-parse", "--show-toplevel"]),
        run(["rev-parse", "--is-bare-repository"]),
        run(["check-ref-format", "--branch", defaultBranch]),
        run(["show-ref", "--verify", "--quiet", `refs/heads/${defaultBranch}`])
      ]);

    if (
      rootResult.exitCode !== 0 ||
      bareResult.exitCode !== 0 ||
      bareResult.stdout.trim() !== "false"
    ) {
      throw new RepositoryRegistrationError(
        "git_invalid",
        "Repository Git identity could not be verified"
      );
    }
    if (branchFormatResult.exitCode !== 0 || branchResult.exitCode !== 0) {
      throw new RepositoryRegistrationError(
        "default_branch_invalid",
        "Repository default branch is invalid or missing"
      );
    }

    const observedRoot = await realpath(rootResult.stdout.trim()).catch(() => "");
    if (observedRoot !== canonicalRoot) {
      throw new RepositoryRegistrationError(
        "git_invalid",
        "Registered path is not the exact Git worktree root"
      );
    }
    return { canonicalRoot, defaultBranch };
  }
}
