---
'overlock': minor
---

First release.

`overlock` reads the diff a coding agent just made and reports the edits that
buy a green check rather than earn one: skipped tests, removed or weakened
assertions, edited expected values, lowered coverage thresholds, snapshots
regenerated alongside the code they cover. Nine rules, zero runtime
dependencies, no network calls, deterministic.

**Commands**

- `overlock check` — the gate, with `--json`, `--compact`, `--staged`,
  `--base`, `--fail-on`, `--test-glob` and `--no-untracked`. Untracked files
  are analysed too: `git diff HEAD` says nothing about a file git has never
  seen, and a brand-new test file arriving already skipped is the most ordinary
  thing an agent does.
- `overlock report` — reads the ledger back, so that after a month you can
  answer _how many times did my agent weaken a test I would have merged without
  noticing?_ Low-severity findings deliberately do not count as catches, so the
  tool cannot clear its own bar on noise.
- `overlock mcp` — an MCP server over stdio exposing `overlock_check` and
  `overlock_report`, so agents discover the tool instead of needing a human to
  wire a bash command into a config first. Implemented directly, because zero
  runtime dependencies is a product decision.
- `overlock init claude` installs a **committed** `.claude/settings.json` Stop
  hook — which is what makes it work in cloud and mobile sessions, since those
  never read `~/.claude/settings.json`. `init codex|cursor|copilot` appends the
  instruction to the file each agent reads.

**Also in the box**

- A composite GitHub Action — `- uses: rxova/overlock@v0` — which on a pull
  request diffs against the base commit rather than the merge commit, and posts
  a single findings comment edited in place. The reviewer is the person who most
  wants this check, and a terminal is not where they are.
- `llms.txt` in the published package: one file an agent can read to learn what
  the rules mean and what the JSON contract is, with a `check:llms` guard so it
  cannot drift from the code.
- `overlock-ignore RULE_ID -- reason` inline suppressions. Rule ID and reason
  both required, no wildcard, and the suppression count appears in every report
  and in the ledger.
- A ledger at `~/.overlock/ledger.jsonl` recording rule, severity and location
  — never file contents.

**Hardened before release.** The tool was attacked from both directions its
real adversaries come from: an agent with write access optimising for green, and
an attacker using overlock itself as the weapon. Among what that closed — a
patch could silence its own findings with one comment line and exit clean; a
skip split across two lines by a formatter evaded detection entirely; a `--base`
that was really `git diff --output=FILE` gave arbitrary file write, reachable
from the MCP boundary; an unrecognised `--fail-on` disabled the gate and
reported `ok: true` on a HIGH finding; untracked symlinks were followed out of
the repository; and control characters in a test name reached terminals, agent
context windows and pull request comments unescaped.
