import { describe, expect, it } from "vitest";
import { checkTags } from "./check-tags.ts";
import { fakeRepo, servingRegistry } from "./release.fixtures.ts";

describe("checkTags", () => {
  it("has nothing to check while npm does not serve the version", () => {
    const log: string[] = [];
    checkTags({
      version: "0.10.4",
      repo: fakeRepo({}).repo,
      registry: servingRegistry(false),
      log: (m) => log.push(m),
    });
    expect(log).toEqual(["overlock@0.10.4 is not on npm; nothing to tag."]);
  });

  it("passes when npm serves the version and both tags exist", () => {
    const log: string[] = [];
    const { repo } = fakeRepo({ "overlock@0.10.4": "abc", "v0.10.4": "abc" });
    checkTags({
      version: "0.10.4",
      repo,
      registry: servingRegistry(true),
      log: (m) => log.push(m),
    });
    expect(log).toEqual(["overlock@0.10.4 is published and tagged."]);
  });

  it("fails naming every missing tag when npm has a version the repository cannot point at", () => {
    const { repo } = fakeRepo({ "overlock@0.10.4": "abc" });
    expect(() =>
      checkTags({ version: "0.10.4", repo, registry: servingRegistry(true), log: () => undefined }),
    ).toThrow("these tags are missing: v0.10.4");
    expect(() =>
      checkTags({
        version: "0.10.4",
        repo: fakeRepo({}).repo,
        registry: servingRegistry(true),
        log: () => undefined,
      }),
    ).toThrow("these tags are missing: overlock@0.10.4 v0.10.4");
  });
});
