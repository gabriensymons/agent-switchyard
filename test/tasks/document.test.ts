import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_TASK_DOCUMENT_BYTES,
  parseTaskDocument
} from "../../src/tasks/document.js";

const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "tasks"
);

async function fixture(name: string): Promise<Buffer> {
  return await readFile(join(fixturesRoot, name));
}

describe("task document parsing", () => {
  it("parses the strict version-1 document contract", async () => {
    expect(parseTaskDocument(await fixture("valid.md"))).toEqual({
      schemaVersion: 1,
      id: "stable-task",
      title: "Add a focused regression test",
      repository: "fixture-repo",
      providerIdentity: "codex-isolated",
      allowedPaths: ["src/example.ts", "test/example.test.ts"],
      verification: ["test-targeted"],
      limits: {
        runtimeMinutes: 15,
        attempts: 1,
        changedFiles: 4,
        diffLines: 300,
        changedFileBytes: 131072,
        commandOutputBytes: 524288
      },
      acceptanceCriteria: [
        "The regression test fails before the fix and passes after it."
      ],
      objective: "Implement only the stated regression fix."
    });
  });

  it("rejects unknown fields at the top level and nested levels", async () => {
    for (const name of ["unknown-key.md", "unknown-nested-key.md"]) {
      const bytes = await fixture(name);
      expect(() => parseTaskDocument(bytes)).toThrowError(
        expect.objectContaining({ code: "invalid_input" })
      );
    }
  });

  it("rejects task-side globs and non-file repository paths", async () => {
    const valid = (await fixture("valid.md")).toString("utf8");
    for (const path of [
      "src/**",
      "/absolute/example.ts",
      "../escape.ts",
      "src\\example.ts",
      "src/",
      "."
    ]) {
      const bytes = Buffer.from(valid.replace("src/example.ts", path));
      expect(() => parseTaskDocument(bytes)).toThrowError(
        expect.objectContaining({ code: "invalid_input" })
      );
    }
  });

  it("rejects forbidden YAML features and multiple documents", async () => {
    for (const name of [
      "duplicate-key.md",
      "anchor.md",
      "alias.md",
      "explicit-tag.md",
      "merge-key.md",
      "directive.md",
      "multiple-documents.md"
    ]) {
      const bytes = await fixture(name);
      expect(() => parseTaskDocument(bytes)).toThrowError(
        expect.objectContaining({ code: "invalid_input" })
      );
    }
  });

  it("rejects invalid UTF-8, a BOM, oversized bytes, and an empty objective", async () => {
    const valid = await fixture("valid.md");
    expect(() => parseTaskDocument(Buffer.from([0xc3, 0x28]))).toThrowError(
      expect.objectContaining({ code: "invalid_input" })
    );
    expect(() => parseTaskDocument(Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      valid
    ]))).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => parseTaskDocument(Buffer.alloc(MAX_TASK_DOCUMENT_BYTES + 1, 0x20)))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const emptyObjective = Buffer.from(
      valid.toString("utf8").replace(
        "\nImplement only the stated regression fix.\n",
        "\n   \n"
      )
    );
    expect(() => parseTaskDocument(emptyObjective)).toThrowError(
      expect.objectContaining({ code: "invalid_input" })
    );
  });

  it("accepts CRLF and YAML 1.2 core strings", async () => {
    const valid = (await fixture("valid.md")).toString("utf8");
    const crlf = Buffer.from(valid.replaceAll("\n", "\r\n"));
    expect(parseTaskDocument(crlf).objective).toBe(
      "Implement only the stated regression fix."
    );
    const coreString = Buffer.from(valid.replace(
      "title: Add a focused regression test",
      "title: yes"
    ));
    expect(parseTaskDocument(coreString).title).toBe("yes");
  });
});
