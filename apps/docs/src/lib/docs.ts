import { getCollection } from "astro:content";
import { docsPages, type LlmsOptions } from "@rxova/docs-kit";

/** Every page as Markdown: the one list the `.md` twins and both llms files share. */
export const pages = async () =>
  docsPages(await getCollection("docs"), {
    origin: import.meta.env.SITE,
    base: import.meta.env.BASE_URL,
  });

/**
 * The llms.txt header and sections, in the sidebar's reading order. The summary
 * is written for a model rather than lifted from `index.md`: what overlock
 * reports, what it refuses to do, and the contract its rule IDs keep.
 */
export const llms: LlmsOptions = {
  project: "overlock",
  summary: [
    "A deterministic CLI that reads a git patch and reports the edits that make a",
    "test suite ask less than it did: skipped tests, removed or loosened",
    "assertions, lowered coverage thresholds, narrowed test data. Eleven rules,",
    "graded high/medium/low; only high fails a run by default. No model calls, no",
    "network calls, no telemetry, zero runtime dependencies, and it never writes to",
    "your code or to the git index. A finding is a statement about the diff and",
    "nothing more: overlock does not run your tests, judge your implementation, or",
    "infer intent. Rule IDs are frozen — adding one is a minor release, changing",
    "what one means is a breaking one. Findings can be silenced, but only by name",
    "and only with a written reason, and every suppression is counted in the report.",
  ],
  sections: [
    ["root", "About"],
    ["learn", "Learn"],
    ["rules", "Rules"],
    ["integrations", "Integrations"],
    ["reference", "Reference"],
    ["under-the-hood", "Under the hood"],
  ],
};

/** Between the llms.txt header and the sections: how to run it, and the rule for agents. */
export const preamble = [
  "## Run it",
  "",
  "    npx overlock                 # the current patch",
  "    npx overlock --json          # the full report, schema 1",
  "    npx overlock init claude     # write the Stop hook into .claude/settings.json",
  "",
  "Exit codes: 0 nothing at or above --fail-on, 1 findings at or above it, 2",
  "overlock could not run. Requires Node.js 20.11 or newer. The package has zero",
  "runtime dependencies, so a cold `npx` is one small download.",
  "",
  "## If you are an agent reading this before editing tests",
  "",
  "The finding you are most likely to cause is `TEST_SKIPPED_ADDED` or",
  "`ASSERTION_WEAKENED`, and the fix for both is the same: make the test pass, or",
  "delete it deliberately and say why. Do not silence a finding to get a green",
  "run. If a suppression really is right, it needs the rule ID and a written",
  "reason — `// overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412` —",
  "and the Stop hook will stop once anyway to quote the claim back at a human.",
  "A directive with no reason, or with a rule ID that does not exist, silences",
  "nothing at all.",
  "",
];
