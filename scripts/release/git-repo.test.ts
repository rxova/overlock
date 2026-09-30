import { describe, expect, it } from "vitest";
import { gitRepo } from "./git-repo.ts";
import { recordingRun } from "./release.fixtures.ts";

describe("gitRepo", () => {
  it("fetches tags, forcing them so a moved major is seen", () => {
    const { run, calls } = recordingRun();
    gitRepo(run).fetchTags();
    expect(calls.map((c) => c.args)).toEqual([["fetch", "--tags", "--force", "origin"]]);
  });

  it("reads the commit a ref names, or null when git knows no such ref", () => {
    expect(gitRepo(recordingRun(() => "abc\n").run).commitOf("v1")).toBe("abc");
    expect(gitRepo(recordingRun(() => "").run).commitOf("v1")).toBeNull();
    const missing = recordingRun(() => {
      throw new Error("unknown revision");
    });
    expect(gitRepo(missing.run).commitOf("v1")).toBeNull();
  });

  it("creates and pushes a tag, with -f only when moving one", () => {
    const { run, calls } = recordingRun();
    const repo = gitRepo(run);
    repo.tag("v1.0.0", "abc");
    repo.tag("v1", "abc", { force: true });
    expect(calls.map((c) => [c.command, ...c.args])).toEqual([
      ["git", "tag", "v1.0.0", "abc"],
      ["git", "push", "origin", "v1.0.0"],
      ["git", "tag", "-f", "v1", "abc"],
      ["git", "push", "-f", "origin", "v1"],
    ]);
  });

  it("shows a file at a commit", () => {
    const { run, calls } = recordingRun(() => "contents");
    expect(gitRepo(run).show("abc", "a/b.md")).toBe("contents");
    expect(calls[0]?.args).toEqual(["show", "abc:a/b.md"]);
  });
});
