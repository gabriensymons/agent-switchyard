import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { switchyardStateRoot } from "./state.js";

export const CODEX_DEFAULT_IDENTITY = "codex-default";
export const CODEX_ISOLATED_IDENTITY = "codex-isolated";

export interface CodexIdentity {
  id: string;
  displayName: string;
  codexHome: string;
  managedBySwitchyard: boolean;
  environment: Record<string, string | undefined>;
}

export interface CodexIdentityOptions {
  stateRoot?: string;
}

export function codexIdentities(
  options: CodexIdentityOptions = {}
): CodexIdentity[] {
  const stateRoot = switchyardStateRoot(options.stateRoot);
  const defaultHome = resolve(homedir(), ".codex");
  const isolatedHome = resolve(stateRoot, "codex", "isolated");
  const legacyEnterpriseHome = resolve(stateRoot, "codex", "enterprise");
  const selectedIsolatedHome =
    existsSync(isolatedHome) || !existsSync(legacyEnterpriseHome)
      ? isolatedHome
      : legacyEnterpriseHome;

  return [
    {
      id: CODEX_DEFAULT_IDENTITY,
      displayName: "Codex (default)",
      codexHome: defaultHome,
      managedBySwitchyard: false,
      environment: { CODEX_HOME: defaultHome }
    },
    {
      id: CODEX_ISOLATED_IDENTITY,
      displayName: "Codex (isolated)",
      codexHome: selectedIsolatedHome,
      managedBySwitchyard: true,
      environment: {
        CODEX_HOME: selectedIsolatedHome,
        OPENAI_API_KEY: undefined,
        CODEX_ACCESS_TOKEN: undefined
      }
    }
  ];
}

export function codexIdentity(
  id: string,
  options: CodexIdentityOptions = {}
): CodexIdentity {
  const identity = codexIdentities(options).find((candidate) => candidate.id === id);
  if (!identity) {
    throw new Error(
      `Unknown Codex identity: ${id}. Expected ${CODEX_DEFAULT_IDENTITY} or ${CODEX_ISOLATED_IDENTITY}.`
    );
  }
  return identity;
}
