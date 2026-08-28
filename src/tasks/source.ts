import { createHash } from "node:crypto";
import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathIsWithin } from "../repositories/paths.js";
import { MAX_TASK_DOCUMENT_BYTES } from "./document.js";
import { TaskIntakeError } from "./errors.js";

export interface ReadTaskSourceOptions {
  intakeRoot: string;
  sourcePath: string;
  beforeOpen?: () => Promise<void> | void;
  afterOpen?: () => Promise<void> | void;
  afterRead?: () => Promise<void> | void;
}

export interface TaskSource {
  canonicalPath: string;
  bytes: Buffer;
  sourceHash: string;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  mode: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

function unsafeSource(): TaskIntakeError {
  return new TaskIntakeError(
    "source_file_unsafe",
    "Task source is not a stable regular file beneath the configured intake root"
  );
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function canonicalIntakeRoot(configuredRoot: string): Promise<{
  lexical: string;
  canonical: string;
  identity: BigIntStats;
}> {
  if (configuredRoot.trim().length === 0 || !isAbsolute(configuredRoot)) {
    throw unsafeSource();
  }
  const lexicalRoot = resolve(configuredRoot);
  const metadata = await lstat(lexicalRoot, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw unsafeSource();
  const canonicalRoot = await realpath(lexicalRoot);
  const canonicalMetadata = await lstat(canonicalRoot, { bigint: true });
  if (!canonicalMetadata.isDirectory() || !sameFile(metadata, canonicalMetadata)) {
    throw unsafeSource();
  }
  return { lexical: lexicalRoot, canonical: canonicalRoot, identity: metadata };
}

async function assertStableIntakeRoot(root: {
  lexical: string;
  canonical: string;
  identity: BigIntStats;
}): Promise<void> {
  const [lexicalMetadata, canonicalMetadata, canonicalPath] = await Promise.all([
    lstat(root.lexical, { bigint: true }),
    lstat(root.canonical, { bigint: true }),
    realpath(root.lexical)
  ]);
  if (
    !lexicalMetadata.isDirectory() ||
    lexicalMetadata.isSymbolicLink() ||
    !canonicalMetadata.isDirectory() ||
    canonicalMetadata.isSymbolicLink() ||
    canonicalPath !== root.canonical ||
    !sameFile(root.identity, lexicalMetadata) ||
    !sameFile(root.identity, canonicalMetadata)
  ) {
    throw unsafeSource();
  }
}

async function assertNoSymlinkTraversal(
  intakeRoot: string,
  lexicalSource: string
): Promise<void> {
  const relativeSource = relative(intakeRoot, lexicalSource);
  if (
    relativeSource === "" ||
    relativeSource === ".." ||
    relativeSource.startsWith(`..${sep}`) ||
    isAbsolute(relativeSource)
  ) {
    throw unsafeSource();
  }
  let current = intakeRoot;
  for (const component of relativeSource.split(sep)) {
    current = join(current, component);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw unsafeSource();
  }
}

async function readBoundedFile(
  handle: Awaited<ReturnType<typeof open>>
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(MAX_TASK_DOCUMENT_BYTES + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await handle.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      offset
    );
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset > MAX_TASK_DOCUMENT_BYTES) throw unsafeSource();
  return Buffer.from(buffer.subarray(0, offset));
}

export async function readTaskSource(
  options: ReadTaskSourceOptions
): Promise<TaskSource> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const intakeRoot = await canonicalIntakeRoot(options.intakeRoot);
    const suppliedSource = isAbsolute(options.sourcePath)
      ? resolve(options.sourcePath)
      : resolve(intakeRoot.lexical, options.sourcePath);
    const relativeSource = pathIsWithin(intakeRoot.lexical, suppliedSource)
      ? relative(intakeRoot.lexical, suppliedSource)
      : pathIsWithin(intakeRoot.canonical, suppliedSource)
        ? relative(intakeRoot.canonical, suppliedSource)
        : null;
    if (relativeSource === null) throw unsafeSource();
    const lexicalSource = resolve(intakeRoot.canonical, relativeSource);
    await assertNoSymlinkTraversal(intakeRoot.canonical, lexicalSource);

    const canonicalSource = await realpath(lexicalSource);
    if (
      canonicalSource !== lexicalSource ||
      !pathIsWithin(intakeRoot.canonical, canonicalSource)
    ) {
      throw unsafeSource();
    }

    const pathBefore = await lstat(lexicalSource, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) throw unsafeSource();
    await options.beforeOpen?.();
    const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
    const nonBlocking = process.platform === "win32" ? 0 : constants.O_NONBLOCK;
    handle = await open(
      lexicalSource,
      constants.O_RDONLY | noFollow | nonBlocking
    );
    const handleBefore = await handle.stat({ bigint: true });
    if (!handleBefore.isFile() || !sameFile(pathBefore, handleBefore)) {
      throw unsafeSource();
    }
    await options.afterOpen?.();
    await assertStableIntakeRoot(intakeRoot);

    const bytes = await readBoundedFile(handle);
    await options.afterRead?.();

    const [handleAfter, pathAfter, finalCanonicalSource] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(lexicalSource, { bigint: true }),
      realpath(lexicalSource),
      assertStableIntakeRoot(intakeRoot)
    ]);
    if (
      !handleAfter.isFile() ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      !sameFile(handleBefore, handleAfter) ||
      !sameFile(handleAfter, pathAfter) ||
      finalCanonicalSource !== canonicalSource ||
      BigInt(bytes.byteLength) !== handleAfter.size
    ) {
      throw unsafeSource();
    }

    return {
      canonicalPath: canonicalSource,
      bytes,
      sourceHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (error) {
    if (error instanceof TaskIntakeError) throw error;
    throw unsafeSource();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
