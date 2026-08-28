import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { promisify } from "node:util";
import { MAX_TASK_DOCUMENT_BYTES } from "../../src/tasks/document.js";
import { readTaskSource } from "../../src/tasks/source.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchyard-intake-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    await rm(root, { recursive: true, force: true });
  }));
});

describe("task source reading", () => {
  it("requires an explicit canonical intake root and reads a regular file", async () => {
    await expect(readTaskSource({
      intakeRoot: "",
      sourcePath: "task.md"
    })).rejects.toMatchObject({ code: "source_file_unsafe" });

    const root = await temporaryRoot();
    const bytes = Buffer.from("---\nschemaVersion: 1\n---\nobjective\n");
    await writeFile(join(root, "task.md"), bytes);
    await expect(readTaskSource({
      intakeRoot: relative(process.cwd(), root),
      sourcePath: "task.md"
    })).rejects.toMatchObject({ code: "source_file_unsafe" });

    const source = await readTaskSource({
      intakeRoot: root,
      sourcePath: "task.md"
    });
    expect(source.canonicalPath).toBe(await realpath(join(root, "task.md")));
    expect(source.bytes).toEqual(bytes);
    expect(source.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("hashes exact bytes so LF and CRLF differ", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "lf.md"), "---\na: b\n---\nbody\n");
    await writeFile(join(root, "crlf.md"), "---\r\na: b\r\n---\r\nbody\r\n");

    const [lf, crlf] = await Promise.all([
      readTaskSource({ intakeRoot: root, sourcePath: "lf.md" }),
      readTaskSource({ intakeRoot: root, sourcePath: join(root, "crlf.md") })
    ]);

    expect(lf.sourceHash).not.toBe(crlf.sourceHash);
    expect(lf.bytes.equals(crlf.bytes)).toBe(false);
  });

  it("rejects escapes, directories, oversized files, and symlink traversal", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeFile(join(outside, "outside.md"), "outside");
    await mkdir(join(root, "directory"));
    await writeFile(
      join(root, "oversized.md"),
      Buffer.alloc(MAX_TASK_DOCUMENT_BYTES + 1, 0x20)
    );
    await writeFile(
      join(root, "maximum.md"),
      Buffer.alloc(MAX_TASK_DOCUMENT_BYTES, 0x20)
    );

    expect((await readTaskSource({
      intakeRoot: root,
      sourcePath: "maximum.md"
    })).bytes).toHaveLength(MAX_TASK_DOCUMENT_BYTES);

    for (const sourcePath of ["../outside.md", "directory", "oversized.md"]) {
      await expect(readTaskSource({ intakeRoot: root, sourcePath }))
        .rejects.toMatchObject({ code: "source_file_unsafe" });
    }

    if (process.platform !== "win32") {
      await symlink(join(outside, "outside.md"), join(root, "file-link.md"));
      await symlink(outside, join(root, "directory-link"));
      for (const sourcePath of ["file-link.md", "directory-link/outside.md"]) {
        await expect(readTaskSource({ intakeRoot: root, sourcePath }))
          .rejects.toMatchObject({ code: "source_file_unsafe" });
      }
    }
  });

  it("rejects intake-root replacement before reading source bytes", async () => {
    if (process.platform === "win32") return;
    const parent = await temporaryRoot();
    const intakeRoot = join(parent, "intake");
    const movedRoot = join(parent, "moved-intake");
    const outsideRoot = await temporaryRoot();
    await mkdir(intakeRoot);
    await writeFile(join(intakeRoot, "task.md"), "trusted");
    await writeFile(join(outsideRoot, "task.md"), "outside");

    await expect(readTaskSource({
      intakeRoot,
      sourcePath: "task.md",
      afterOpen: async () => {
        await rename(intakeRoot, movedRoot);
        await symlink(outsideRoot, intakeRoot);
      }
    })).rejects.toMatchObject({ code: "source_file_unsafe" });
  });

  it("does not block if a regular source is raced to a FIFO before open", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const sourcePath = join(root, "task.md");
    await writeFile(sourcePath, "trusted");
    const startedAt = Date.now();
    let releasePromise = Promise.resolve();
    const releaseTimer = setTimeout(() => {
      releasePromise = writeFile(sourcePath, "release").catch(() => undefined);
    }, 1_500);

    await expect(readTaskSource({
      intakeRoot: root,
      sourcePath,
      beforeOpen: async () => {
        await rename(sourcePath, join(root, "original.md"));
        await execFileAsync("mkfifo", [sourcePath]);
      }
    })).rejects.toMatchObject({ code: "source_file_unsafe" });
    clearTimeout(releaseTimer);
    await releasePromise;
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("detects source replacement between reading and final metadata checks", async () => {
    const root = await temporaryRoot();
    const sourcePath = join(root, "task.md");
    const replacementPath = join(root, "replacement.md");
    await writeFile(sourcePath, "original");
    await writeFile(replacementPath, "replacement");

    await expect(readTaskSource({
      intakeRoot: root,
      sourcePath,
      afterRead: async () => {
        await rename(replacementPath, sourcePath);
      }
    })).rejects.toMatchObject({ code: "source_file_unsafe" });
  });
});
