import { describe, expect, it } from "vitest";
import { fakeReleases, fakeRepo } from "./release.fixtures.ts";
import { tagAction } from "./tag-action.ts";

const CHANGELOG = "## 0.10.4\n\n- fix\n\n## 0.10.3\n";

describe("tagAction", () => {
  it("tags vX.Y.Z at the published commit, moves the major, and releases with the changelog entry", () => {
    const { repo, tags, pushed } = fakeRepo(
      { "overlock@0.10.4": "abc", v0: "old" },
      { "abc:packages/overlock/CHANGELOG.md": CHANGELOG },
    );
    const { releases, created } = fakeReleases();
    const log: string[] = [];
    tagAction({ version: "0.10.4", repo, releases, log: (m) => log.push(m) });

    expect(tags["v0.10.4"]).toBe("abc");
    expect(tags.v0).toBe("abc");
    expect(pushed).toEqual(["v0.10.4", "v0 (moved)"]);
    expect(created).toEqual([{ tag: "v0.10.4", sha: "abc", notes: "\n- fix\n\n" }]);
    expect(log).toContain("pointing v0 at abc");
  });

  it("names the major from the version, so 1.0.0 starts v1", () => {
    const { repo, tags } = fakeRepo({ "overlock@1.0.0": "abc" });
    tagAction({ version: "1.0.0", repo, releases: fakeReleases().releases, log: () => undefined });
    expect(tags.v1).toBe("abc");
  });

  it("re-run: keeps the existing tag, still moves the major, and does not release twice", () => {
    const { repo, pushed } = fakeRepo({ "overlock@0.10.4": "abc", "v0.10.4": "abc", v0: "old" });
    const { releases, created } = fakeReleases(["v0.10.4"]);
    const log: string[] = [];
    tagAction({ version: "0.10.4", repo, releases, log: (m) => log.push(m) });

    expect(pushed).toEqual(["v0 (moved)"]);
    expect(created).toEqual([]);
    expect(log).toContain("v0.10.4 is already released");
  });

  it("refuses a version tag that already names another commit, and moves nothing", () => {
    const { repo, pushed } = fakeRepo({ "overlock@0.10.4": "abc", "v0.10.4": "other" });
    const { releases, created } = fakeReleases();
    expect(() => tagAction({ version: "0.10.4", repo, releases, log: () => undefined })).toThrow(
      "v0.10.4 already names other, but this release is abc.",
    );
    expect(pushed).toEqual([]);
    expect(created).toEqual([]);
  });

  it("fails when changesets wrote no tag for the version", () => {
    const { repo } = fakeRepo({});
    expect(() =>
      tagAction({
        version: "0.10.4",
        repo,
        releases: fakeReleases().releases,
        log: () => undefined,
      }),
    ).toThrow("overlock@0.10.4 is not tagged");
  });
});
