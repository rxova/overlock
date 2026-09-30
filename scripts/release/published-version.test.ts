import { describe, expect, it } from "vitest";
import { publishedVersion } from "./published-version.ts";

describe("publishedVersion", () => {
  it("reads overlock's version from the published list", () => {
    expect(publishedVersion('[{"name":"overlock","version":"0.10.4"}]')).toBe("0.10.4");
  });

  it("is null when nothing was published", () => {
    expect(publishedVersion("")).toBeNull();
    expect(publishedVersion("[]")).toBeNull();
  });

  it("is null when overlock is not among the published packages, or has no version", () => {
    expect(publishedVersion('[{"name":"other","version":"1.0.0"}]')).toBeNull();
    expect(publishedVersion('[{"name":"overlock","version":""}]')).toBeNull();
  });

  it("rejects an output that is not a list", () => {
    expect(() => publishedVersion('{"name":"overlock"}')).toThrow("not a list");
    expect(() => publishedVersion("not json")).toThrow();
  });
});
