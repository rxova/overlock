import { describe, expect, it } from "vitest";
import { npmRegistry } from "./npm-registry.ts";
import { recordingRun } from "./release.fixtures.ts";

describe("npmRegistry", () => {
  it("serves a version when npm view answers with exactly it", () => {
    const { run, calls } = recordingRun(() => "0.10.4\n");
    expect(npmRegistry(run).serves("overlock", "0.10.4")).toBe(true);
    expect(calls[0]?.args).toEqual(["view", "overlock@0.10.4", "version"]);
  });

  it("does not serve it on another answer or on a failed lookup", () => {
    expect(npmRegistry(recordingRun(() => "").run).serves("overlock", "0.10.4")).toBe(false);
    const missing = recordingRun(() => {
      throw new Error("E404");
    });
    expect(npmRegistry(missing.run).serves("overlock", "0.10.4")).toBe(false);
  });
});
