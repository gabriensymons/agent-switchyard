import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../../src/core/json.js";

describe("extractJsonObject", () => {
  it("parses JSON surrounded by CLI warnings", () => {
    expect(
      extractJsonObject('warning: optional setup failed\n{"status":"ok"}\n')
    ).toEqual({ status: "ok" });
  });

  it("rejects output without an object", () => {
    expect(() => extractJsonObject("plain text")).toThrow(
      "did not contain a JSON object"
    );
  });
});
