import { describe, expect, it } from "vitest";
import { changelogNotes } from "./changelog-notes.ts";

const CHANGELOG = [
  "# overlock",
  "",
  "## 0.10.4",
  "",
  "### Patch Changes",
  "",
  "- fix",
  "",
  "## 0.10.3",
  "",
  "- older",
].join("\n");

describe("changelogNotes", () => {
  it("takes the entry under the version's heading, up to the next one", () => {
    expect(changelogNotes(CHANGELOG, "0.10.4")).toBe("\n### Patch Changes\n\n- fix\n\n");
  });

  it("takes the last entry to the end of the file", () => {
    expect(changelogNotes(CHANGELOG, "0.10.3")).toBe("\n- older\n");
  });

  it("points at the changelog when the version has no entry, or an empty one", () => {
    expect(changelogNotes(CHANGELOG, "9.9.9")).toBe("See packages/overlock/CHANGELOG.md.\n");
    expect(changelogNotes("## 1.0.0\n## 0.9.0", "1.0.0")).toBe(
      "See packages/overlock/CHANGELOG.md.\n",
    );
  });
});
