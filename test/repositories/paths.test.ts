import { describe, expect, it } from "vitest";
import {
  isSystemProtectedPolicyPath,
  matchesPolicyPathPattern,
  pathIsWithin,
  pathsOverlap,
  repositoryPathIsAllowed,
  validateExactRepositoryPath,
  validatePolicyPathPattern
} from "../../src/repositories/paths.js";

describe("repository path policy", () => {
  it("accepts the bounded M1 pattern dialect", () => {
    expect(validatePolicyPathPattern("src/**/*.ts", "allowed")).toBe(
      "src/**/*.ts"
    );
    expect(matchesPolicyPathPattern("src/**/*.ts", "src/core/a.ts")).toBe(true);
    expect(matchesPolicyPathPattern("src/**/*.ts", "src/a.js")).toBe(false);
    expect(matchesPolicyPathPattern("test/*/fixture.ts", "test/unit/fixture.ts")).toBe(true);
  });

  it.each([
    "/absolute/path",
    "../escape",
    "src\\windows",
    "src/[ab].ts",
    "src/{one,two}.ts",
    "**/everything",
    "src/**suffix",
    "src//empty"
  ])("rejects unsupported pattern %s", (pattern) => {
    expect(() => validatePolicyPathPattern(pattern, "allowed")).toThrow();
  });

  it.each([
    ".git/config",
    "src/.env",
    "src/secrets.pem",
    ".github/workflows/release.yml",
    "deploy/production.yml",
    "package.json"
  ])("protects sensitive or publication path %s", (path) => {
    expect(isSystemProtectedPolicyPath(path)).toBe(true);
    expect(() => validatePolicyPathPattern(path, "allowed")).toThrow();
  });

  it("allows protected names to appear in an explicit deny list", () => {
    expect(validatePolicyPathPattern(".git/**", "forbidden")).toBe(".git/**");
  });

  it("requires task-style exact paths to omit globs and protected paths", () => {
    expect(validateExactRepositoryPath("src/example.ts")).toBe("src/example.ts");
    expect(validateExactRepositoryPath(".")).toBe(".");
    expect(() => validateExactRepositoryPath("src/*.ts")).toThrow();
    expect(() => validateExactRepositoryPath(".env")).toThrow();
  });

  it("applies allowed, forbidden, and permanent system path ceilings", () => {
    expect(
      repositoryPathIsAllowed(["src/**"], ["src/generated/**"], "src/core/a.ts")
    ).toBe(true);
    expect(
      repositoryPathIsAllowed(
        ["src/**"],
        ["src/generated/**"],
        "src/generated/a.ts"
      )
    ).toBe(false);
    expect(repositoryPathIsAllowed(["src/**"], [], "src/.env")).toBe(false);
    expect(repositoryPathIsAllowed(["src/**"], [], "test/a.ts")).toBe(false);
  });

  it("compares canonical paths by segment rather than string prefix", () => {
    expect(pathIsWithin("/repos/app", "/repos/app/src")).toBe(true);
    expect(pathIsWithin("/repos/app", "/repos/application")).toBe(false);
    expect(pathsOverlap("/repos/app", "/repos/app/worktrees")).toBe(true);
    expect(pathsOverlap("/repos/app", "/worktrees/app")).toBe(false);
  });
});
