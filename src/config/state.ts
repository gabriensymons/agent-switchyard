import { homedir } from "node:os";
import { resolve } from "node:path";

export function switchyardStateRoot(override?: string): string {
  return resolve(
    override ??
      process.env["SWITCHYARD_STATE_ROOT"] ??
      resolve(homedir(), ".agent-switchyard")
  );
}
