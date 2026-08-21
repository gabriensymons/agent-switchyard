import type { CommandRunner } from "../core/command-runner.js";
import type { Diagnostic, GitProbe } from "../core/types.js";
import { cleanVersion } from "../providers/shared.js";

export interface GitProbeContext {
  cwd: string;
  timeoutMs: number;
  now: () => Date;
  runner: CommandRunner;
}

export async function probeGit(context: GitProbeContext): Promise<GitProbe> {
  const observedAt = context.now().toISOString();
  const run = async (args: string[]) =>
    await context.runner.run({
      command: "git",
      args,
      cwd: context.cwd,
      timeoutMs: context.timeoutMs
    });

  const versionResult = await run(["--version"]);
  if (versionResult.errorCode === "ENOENT") {
    return {
      state: "not_installed",
      installed: false,
      isRepository: false,
      clean: null,
      observedAt,
      diagnostics: [
        {
          id: "git.installation",
          status: "fail",
          summary: "Git was not found on PATH"
        }
      ]
    };
  }

  const version = cleanVersion(versionResult.stdout || versionResult.stderr);
  const rootResult = await run(["rev-parse", "--show-toplevel"]);
  if (rootResult.exitCode !== 0) {
    return {
      state: "degraded",
      installed: true,
      isRepository: false,
      clean: null,
      ...(version ? { version } : {}),
      observedAt,
      diagnostics: [
        {
          id: "git.repository",
          status: "warning",
          summary: "The selected working directory is not inside a Git repository"
        }
      ]
    };
  }

  const [branchResult, statusResult] = await Promise.all([
    run(["branch", "--show-current"]),
    run(["status", "--porcelain=v1", "--untracked-files=normal"])
  ]);
  const diagnostics: Diagnostic[] = [];
  const clean = statusResult.exitCode === 0 ? statusResult.stdout.trim() === "" : null;
  if (clean === false) {
    diagnostics.push({
      id: "git.cleanliness",
      status: "warning",
      summary: "Repository has uncommitted changes"
    });
  }

  return {
    state: statusResult.exitCode === 0 ? "ready" : "error",
    installed: true,
    isRepository: true,
    clean,
    ...(version ? { version } : {}),
    root: rootResult.stdout.trim(),
    branch: branchResult.stdout.trim() || "(detached)",
    observedAt,
    diagnostics
  };
}
