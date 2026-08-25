import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitRepositoryInspector } from "../../src/git/repository-inspector.js";
import {
  commandKey,
  commandResult,
  FakeCommandRunner
} from "../helpers/fake-runner.js";

const temporaryRoots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "switchyard-git-inspector-"));
  const root = await realpath(created);
  temporaryRoots.push(root);
  await mkdir(join(root, ".git"));
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) =>
      await rm(root, { recursive: true, force: true })
    )
  );
});

describe("GitRepositoryInspector", () => {
  it("uses only bounded local read commands", async () => {
    const root = await fixtureRoot();
    const worktrees = await fixtureRoot();
    await rm(join(worktrees, ".git"), { recursive: true });
    const result = (stdout = "") => commandResult({ stdout });
    const runner = new FakeCommandRunner(
      new Map([
        [
          commandKey("git", ["-C", worktrees, "rev-parse", "--show-toplevel"]),
          commandResult({ exitCode: 128 })
        ],
        [
          commandKey("git", ["-C", root, "rev-parse", "--show-toplevel"]),
          result(`${root}\n`)
        ],
        [
          commandKey("git", ["-C", root, "rev-parse", "--is-bare-repository"]),
          result("false\n")
        ],
        [
          commandKey("git", ["-C", root, "check-ref-format", "--branch", "main"]),
          result("main\n")
        ],
        [
          commandKey("git", ["-C", root, "show-ref", "--verify", "--quiet", "refs/heads/main"]),
          result()
        ]
      ])
    );
    const inspector = new GitRepositoryInspector({ runner, timeoutMs: 1_000 });

    await inspector.assertWorktreeContainer(worktrees);
    await expect(inspector.inspect(root, "main")).resolves.toEqual({
      canonicalRoot: root,
      defaultBranch: "main"
    });
    expect(runner.calls).toHaveLength(5);
    expect(runner.calls.every((call) => call.command === "git")).toBe(true);
    expect(
      runner.calls.flatMap((call) => call.args).some((argument) =>
        ["fetch", "pull", "push", "clone"].includes(argument)
      )
    ).toBe(false);
    expect(runner.calls.every((call) => call.timeoutMs === 1_000)).toBe(true);
  });

  it("rejects non-portable branch input before invoking Git", async () => {
    const root = await fixtureRoot();
    const runner = new FakeCommandRunner(new Map());
    const inspector = new GitRepositoryInspector({ runner });

    await expect(inspector.inspect(root, "main\0unsafe")).rejects.toMatchObject({
      code: "default_branch_invalid"
    });
    expect(runner.calls).toEqual([]);
  });
});
