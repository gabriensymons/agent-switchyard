import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCodexIdentity } from "../../src/auth/codex.js";
import { codexIdentity } from "../../src/config/codex-identities.js";

describe("prepareCodexIdentity", () => {
  it("creates a private file-backed isolated credential home without overwriting it", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "switchyard-auth-test-"));
    const identity = codexIdentity("codex-isolated", { stateRoot });

    const first = await prepareCodexIdentity(identity);
    const second = await prepareCodexIdentity(identity);

    expect(first.createdConfig).toBe(true);
    expect(second.createdConfig).toBe(false);
    expect(await readFile(first.configPath, "utf8")).toContain(
      'cli_auth_credentials_store = "file"'
    );
    expect((await stat(first.configPath)).mode & 0o777).toBe(0o600);
  });
});
