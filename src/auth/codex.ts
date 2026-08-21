import { spawn } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import type { CodexIdentity } from "../config/codex-identities.js";

const ISOLATED_CONFIG = `# Managed by Agent Switchyard.
# Credentials stay in this identity's CODEX_HOME and must never be committed.
cli_auth_credentials_store = "file"
`;

function mergedEnvironment(
  overrides: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
  return environment;
}

export interface PreparedCodexIdentity {
  id: string;
  codexHome: string;
  configPath: string;
  createdConfig: boolean;
}

export async function prepareCodexIdentity(
  identity: CodexIdentity
): Promise<PreparedCodexIdentity> {
  if (!identity.managedBySwitchyard) {
    throw new Error(
      `${identity.id} uses the existing default Codex home and must not be prepared or modified by Switchyard.`
    );
  }

  await mkdir(identity.codexHome, { recursive: true, mode: 0o700 });
  const configPath = `${identity.codexHome}/config.toml`;
  let createdConfig = false;

  try {
    const handle = await open(configPath, "wx", 0o600);
    try {
      await handle.writeFile(ISOLATED_CONFIG, "utf8");
      createdConfig = true;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existingConfig = await readFile(configPath, "utf8");
    if (!/^cli_auth_credentials_store\s*=\s*"file"\s*$/mu.test(existingConfig)) {
      throw new Error(
        `${configPath} already exists but does not require file-backed credentials; refusing to start login because credential isolation is not guaranteed.`,
        { cause: error }
      );
    }
  }

  return { id: identity.id, codexHome: identity.codexHome, configPath, createdConfig };
}

export async function loginCodexIdentity(
  identity: CodexIdentity,
  options: { deviceAuth?: boolean } = {}
): Promise<number> {
  await prepareCodexIdentity(identity);
  const args = ["login", ...(options.deviceAuth ? ["--device-auth"] : [])];

  return await new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      env: mergedEnvironment(identity.environment),
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}
