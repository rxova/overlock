import { describe, expect, it } from "vitest";
import { ghReleases } from "./gh-releases.ts";
import { recordingRun } from "./release.fixtures.ts";

describe("ghReleases", () => {
  it("reports whether a release exists from gh's exit status", () => {
    expect(ghReleases(recordingRun().run).exists("v1.0.0")).toBe(true);
    const missing = recordingRun(() => {
      throw new Error("release not found");
    });
    expect(ghReleases(missing.run).exists("v1.0.0")).toBe(false);
  });

  it("creates the release at the commit as the latest, with the notes on stdin", () => {
    const { run, calls } = recordingRun();
    ghReleases(run).create({ tag: "v1.0.0", sha: "abc", notes: "- fix\n" });
    expect(calls).toEqual([
      {
        command: "gh",
        args: [
          "release",
          "create",
          "v1.0.0",
          "--target",
          "abc",
          "--title",
          "v1.0.0",
          "--notes-file",
          "-",
          "--latest",
        ],
        input: "- fix\n",
      },
    ]);
  });
});
