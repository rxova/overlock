# overlock

## 0.2.0

### Minor Changes

- [#13](https://github.com/rxova/overlock/pull/13) [`984f7ff`](https://github.com/rxova/overlock/commit/984f7ffea07f490b9ec572b2f8986e9913373e5c) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Grade a deleted test file on what the patch does with its cases, and give it a
  way out.

  `TEST_REMOVED` now matches the case names a deleted file lost against every name
  the patch adds anywhere in it, rather than per file — so splitting one test file
  into six is visible to it. All names re-homed grades `medium`; some missing
  stays `high` and names the ones that went. Deleting the module a test file is
  named after also grades `medium`, since deleting a feature deletes its tests.

  Findings about a file rather than a line now report `line: null` and an `id` of
  `<rule>:<file>`, instead of pointing at a line 1 that a deleted file does not
  have. They are silenced by naming the path from a line the patch still has:
  `// overlock-ignore TEST_REMOVED src/api.test.ts -- reason`. Previously they
  could not be silenced at all.

  `--severity RULE_ID=level` (and the action's `severity` input) regrades one rule
  without dropping `--fail-on` globally and disarming the others.

  The action's pull request comment now leads with what blocks and folds the rest,
  grouped by rule, into a `<details>`.

- [#13](https://github.com/rxova/overlock/pull/13) [`1c1a469`](https://github.com/rxova/overlock/commit/1c1a469b4e887f3eb7ad92e671a7a449d93cd650) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Answer the question a rename actually raises: what changed that it does not
  explain?

  A substitution the patch applies wholesale is now inferred from the patch
  itself, and every finding is marked against it. A rename across six hundred
  files reports as three lines — the rename, how many findings are consistent with
  it, and how many are not — with the residual printed in full above the fold.
  The same comparison sees through a formatter, so a line the shorter name let
  prettier re-join is not read as a change, and `TEST_AND_IMPL_TOGETHER` no longer
  fires on pure re-wrapping.

  Nothing is decided by the inference. An explained finding keeps its severity,
  still counts, and still blocks — a patch large enough to establish a rename is
  large enough to hide one real edit inside, and that residual is the whole point.

  `Overlock-Allow: RULE_ID [path] -- reason`, read from the commit messages in the
  range and from `--allow-file` (the action passes the pull request body), is the
  proportionate way to acknowledge a whole patch. It needs a written reason like
  every other escape hatch here, and it does nothing at Stop time, where
  uncommitted work has no commit message to read.

  Repeated findings are collapsed wherever they are printed: the same edit in
  twenty files is one row with a count.

  `overlock report` now counts each rule once per run rather than once per
  finding, so one afternoon's rename cannot dominate a month of history.

### Patch Changes

- [#16](https://github.com/rxova/overlock/pull/16) [`ae706ff`](https://github.com/rxova/overlock/commit/ae706ffd28e16dcc278d3dd24e28bd7ab61b1a4d) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - See a weakened assertion the same commit's rename would have hidden.

  `ASSERTION_WEAKENED` and `EXPECTED_VALUE_CHANGED` pair a removed line with an
  added one by comparing their text, so a rename that lands in the subject broke
  the pair and the rule fired nothing at all:
  `expect(trainmotherfoca.total()).toBe(42)` becoming
  `expect(trainmf.total()).toBeDefined()` reported as silence. Both rules now pair
  against the pre-image with the patch's inferred substitution applied — the
  residual analysis can only mark findings that exist, and there was no finding to
  mark. Evidence still shows the lines as the patch wrote them.

- [#17](https://github.com/rxova/overlock/pull/17) [`b114d45`](https://github.com/rxova/overlock/commit/b114d4529783343b6dbb9e496d09dc13f30e040e) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Move the test toolchain to the workspace root

  `vitest`, `@vitest/coverage-v8` and `@types/node` are declared once at the root
  instead of per package. Declaring them in both packages had them resolving
  vite's optional `esbuild` peer differently, which carried two full vite and
  vitest trees in the lockfile and a second esbuild download in every CI job.

  This is a development-time change only: devDependencies are never installed for
  consumers of the package, so nothing about the published build, its runtime
  dependencies or its public API changes.

## 0.1.0

### Minor Changes

- [`7088671`](https://github.com/rxova/overlock/commit/70886717c7e9c9d83b3c0faa6d916953a82de49b) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - First release.

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
