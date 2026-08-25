import { describe, expect, it } from "vitest";
import {
  parseRepositoryPolicy,
  SYSTEM_MAXIMUM_LIMITS
} from "../../src/repositories/policy.js";

function policy(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    operatingMode: "local-only",
    allowedPaths: ["src/**", "test/**"],
    forbiddenPaths: ["generated/**"],
    providerIdentities: ["codex-isolated"],
    verificationCommands: [
      {
        id: "test-targeted",
        executable: "npm",
        args: ["run", "test-unit"],
        cwd: ".",
        timeoutMs: 60_000
      }
    ],
    limits: { ...SYSTEM_MAXIMUM_LIMITS },
    ...overrides
  };
}

describe("repository policy", () => {
  it("parses a complete immutable local-only policy", () => {
    expect(parseRepositoryPolicy(policy())).toMatchObject({
      schemaVersion: 1,
      operatingMode: "local-only",
      providerIdentities: ["codex-isolated"]
    });
  });

  it("rejects unknown keys at every level", () => {
    expect(() => parseRepositoryPolicy(policy({ remotePush: true }))).toThrow();
    expect(() =>
      parseRepositoryPolicy(
        policy({
          verificationCommands: [
            {
              id: "test",
              executable: "npm",
              args: ["test"],
              cwd: ".",
              timeoutMs: 1_000,
              environment: { TOKEN: "not-allowed" }
            }
          ]
        })
      )
    ).toThrow();
  });

  it("rejects duplicate authority entries", () => {
    expect(() =>
      parseRepositoryPolicy(
        policy({ providerIdentities: ["codex-isolated", "codex-isolated"] })
      )
    ).toThrow();
    expect(() =>
      parseRepositoryPolicy(
        policy({ allowedPaths: ["src/**", "src/**"] })
      )
    ).toThrow();
    const command = {
      id: "test",
      executable: "npm",
      args: ["test"],
      cwd: ".",
      timeoutMs: 1_000
    };
    expect(() =>
      parseRepositoryPolicy(
        policy({ verificationCommands: [command, command] })
      )
    ).toThrow();
  });

  it("rejects unknown identities and limits above system ceilings", () => {
    expect(() =>
      parseRepositoryPolicy(policy({ providerIdentities: ["codex"] }))
    ).toThrow();
    expect(() =>
      parseRepositoryPolicy(
        policy({
          limits: {
            ...SYSTEM_MAXIMUM_LIMITS,
            changedFiles: SYSTEM_MAXIMUM_LIMITS.changedFiles + 1
          }
        })
      )
    ).toThrow();
  });

  it.each([
    { executable: "bash", args: ["-c", "npm test"] },
    { executable: "git", args: ["push"] },
    { executable: "node", args: ["--eval", "process.exit()"] },
    { executable: "npm", args: ["publish"] },
    { executable: "npm", args: ["run", "${SCRIPT}"] }
  ])("rejects shell, interpolation, or mutating command %#", ({ executable, args }) => {
    expect(() =>
      parseRepositoryPolicy(
        policy({
          verificationCommands: [
            { id: "unsafe", executable, args, cwd: ".", timeoutMs: 1_000 }
          ]
        })
      )
    ).toThrow();
  });

  it("requires verification timeouts to fit within repository runtime", () => {
    expect(() =>
      parseRepositoryPolicy(
        policy({
          verificationCommands: [
            {
              id: "slow",
              executable: "npm",
              args: ["test"],
              cwd: ".",
              timeoutMs: 120_000
            }
          ],
          limits: { ...SYSTEM_MAXIMUM_LIMITS, runtimeMinutes: 1 }
        })
      )
    ).toThrow();
  });
});
