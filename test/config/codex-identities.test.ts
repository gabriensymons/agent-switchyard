import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_DEFAULT_IDENTITY,
  CODEX_ISOLATED_IDENTITY,
  codexIdentities
} from "../../src/config/codex-identities.js";

describe("codexIdentities", () => {
  it("keeps the existing default identity separate from isolated credentials", () => {
    const [defaultIdentity, isolated] = codexIdentities({
      stateRoot: "/switchyard-state"
    });

    expect(defaultIdentity).toEqual({
      id: CODEX_DEFAULT_IDENTITY,
      displayName: "Codex (default)",
      codexHome: expect.stringMatching(/\/\.codex$/u),
      managedBySwitchyard: false,
      environment: { CODEX_HOME: expect.stringMatching(/\/\.codex$/u) }
    });
    expect(isolated).toEqual({
      id: CODEX_ISOLATED_IDENTITY,
      displayName: "Codex (isolated)",
      codexHome: "/switchyard-state/codex/isolated",
      managedBySwitchyard: true,
      environment: {
        CODEX_HOME: "/switchyard-state/codex/isolated",
        OPENAI_API_KEY: undefined,
        CODEX_ACCESS_TOKEN: undefined
      }
    });
  });

  it("keeps using a pre-rename isolated home without inspecting credentials", async () => {
    const stateRoot = await mkdtemp(
      join(tmpdir(), "switchyard-legacy-identity-")
    );
    const legacyHome = join(stateRoot, "codex", "enterprise");
    await mkdir(legacyHome, { recursive: true });

    const [, isolated] = codexIdentities({ stateRoot });

    expect(isolated?.id).toBe(CODEX_ISOLATED_IDENTITY);
    expect(isolated?.codexHome).toBe(legacyHome);
  });
});
