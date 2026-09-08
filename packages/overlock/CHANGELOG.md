# overlock

## 0.5.0

### Minor Changes

- [#33](https://github.com/rxova/overlock/pull/33) [`34ad9e3`](https://github.com/rxova/overlock/commit/34ad9e388f751e68ff1cb08ff22d3d9da5a17859) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Add `PREDICATE_NARROWED`, which watches the set an assertion ranges over rather
  than the assertion itself.
  
  Every other rule reads the `expect`. None of them read the predicate that decides
  how many times it runs, and that is the quietest way to take coverage out of a
  suite: `FEATURE_KEYS.filter((k) => tier(k) === 'free')` gaining
  `&& !NOT_SOLD_AT_FREE.includes(k)` leaves every assertion in the file untouched
  while the loop around them stops visiting four keys. The diff is one line and it
  reads like a clarification.
  
  Four shapes fire it: a `.filter(...)` predicate that gained a conjunct, an
  iterated or parameterised source that gained a `.filter(...)` or `.slice(...)`,
  a literal case table that lost rows, and a list whose name says it holds
  exemptions growing by one. `high` when the narrowed set is consumed by a
  `for...of`, a `.forEach` or an `it.each`; `medium` when it is only assigned to a
  variable, because a diff cannot see whether that variable reaches an assertion.

## 0.4.0

### Minor Changes

- [#27](https://github.com/rxova/overlock/pull/27) [`bedb16c`](https://github.com/rxova/overlock/commit/bedb16cd621f3e46e2788185a2296239708143c2) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Read assertions and test cases at the scale of the test, not the line.

  Four false positives reported from real use, and the four fixes are the same
  idea: a finding is only worth as much as the reason attached to it.

  - **`ASSERTION_NARROWED`, a new rule.** `expect(row).toEqual({ id, state })`
    becoming `expect(row.state).toBeNull()` is a real finding with a wrong reason
    when it is called a weakened assertion — the assertion still names a value, it
    just covers less of it. Narrowing now has its own rule ID and its own sentence.
  - **The existence-check family is three members wide.** `toBeDefined()`,
    `toBeTruthy()` and `not.toBeNull()`. `toBeNull()`, `toBeUndefined()` and
    `toBe(false)` name a value as exactly as `toBe(3)` does and no longer report as
    weakened; the message says which loose thing the replacement does check.
  - **Pairing is per edit, not per hunk.** A hunk spans several test cases, and a
    removal in one was being paired with an addition in another. An assertion that
    is still standing further down the file is a move, not a weakening.
  - **Findings are graded by the case around them.** A test that gives up
    specificity on one line while gaining assertions elsewhere is `medium` and says
    how many it gained; one that only lost stays `high`.
  - **A retitled test is not a removed one.** `TEST_REMOVED` matches a case by its
    title, by its title under the patch's own rename, and failing both by its body.
  - **Moved spec files collapse into one finding.** Eight files re-homed is one
    decision, one finding and one acknowledgement rather than eight of each.
  - **Acknowledgements can be as narrow as the finding.** `Overlock-Allow:` takes
    `<path>`, `<path>:<line>` or a quoted `<path>::<case name>`, so fifteen ported
    cases can be acknowledged while the two nobody explained keep standing. One
    that matches nothing is now reported as `allowances_unused` rather than
    silently doing nothing.
  - **A name that became two names is one rename.** `cloud_sync` splitting into
    `cloud_backup` and `multi_device` is inferred as a split, and whatever is left
    unexplained is clustered by the name most of it mentions.

  The wire contract gains `subject` on a finding and `allowances_unused` on the
  report; nothing existing changed meaning.

## 0.3.0

### Minor Changes

- [#22](https://github.com/rxova/overlock/pull/22) [`d23bac9`](https://github.com/rxova/overlock/commit/d23bac9e7a150edf440c1df0b80d9274e0f5b72b) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Read `--base <ref>` as a fork point, and say what each run examined

  `--base main` ran `git diff main`, which compares main's tip to this working
  tree. The moment main moved ahead, every file main gained read as a deletion
  here — and a test file among them was reported as `TEST_REMOVED`, at HIGH, on a
  branch that never touched it. It now resolves to the fork point, `main...HEAD`:
  what this branch did since it left main. `--base-mode direct` asks for the old,
  literal comparison.

  `check` now defaults to `auto` like the hook and the MCP tool, instead of
  looking only at the working tree. A pre-push gate runs when the commits exist
  and nothing is uncommitted, which was precisely when the old default had least
  to look at, and it reported that as clean.

  Every verdict now names its scope — `83 files, 3 commits, against 492b7ad` — on
  clean runs as well as findings, and a range that resolved to nothing is reported
  as `nothing to examine` rather than as a pass. `--fail-on-empty` makes that
  exit 1. `--explain-base` prints how the base was chosen, in order.

  `Report` gains an optional `scope` field, `{ files, commits }`, set on any run
  against a repository.

- [#23](https://github.com/rxova/overlock/pull/23) [`310ec0f`](https://github.com/rxova/overlock/commit/310ec0fb1e0825609a8416cfd8b5bde003353ae2) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Read settings from the repository, so the CLI, the hook and the action agree

  The CLI, the GitHub action and the Stop hook each arrived at their own base,
  their own fail-on and their own severity grades. The same patch could pass
  locally and block in CI with nothing to point at, and anyone wanting the three
  to agree had to carry the policy between them in a wrapper script — which is
  where the drift lives, not where it is fixed.

  `overlock.config.json` beside your `package.json`, or an `overlock` key inside
  it, is now read by all of them: `base`, `baseMode`, `failOn`, `failOnEmpty`,
  `severity`, `testGlob`, `untracked`. The nearest declaration at or above the
  working directory applies, so a package in a monorepo can have its own answer.
  A flag always wins over the file. `--config <file>` points at one directly and
  `--no-config` ignores the search.

  An unknown setting or a bad value stops the run with exit 2 rather than being
  skipped, because a `failon` typo that silently did nothing is the same failure
  in miniature.

  `overlock config` prints the settings in force and whether each came from a
  flag, the file or the built-in default. `Report` gains `fail_on`, the threshold
  the run actually applied, so a renderer names the same one the run used — the
  action's pull request comment now reads it from there.

  The action no longer passes `--base auto` or `--fail-on high` when its inputs
  are unset, so the repository's own configuration is what answers. It gains a
  `fail-on` output carrying the threshold that was applied, logs the settings in
  force in a collapsed group, and prints `--explain-base` alongside the readable
  report.

- [#24](https://github.com/rxova/overlock/pull/24) [`35e0496`](https://github.com/rxova/overlock/commit/35e0496d6d0bdb014006deb8fd479db0f5e87478) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Let the Stop hook see what the agent committed

  The hook read uncommitted work. Agents commit and then stop, so in the ordinary
  workflow it saw nothing at all — a strange blind spot for a tool whose subject
  is what your coding agent did to your tests.

  At Stop time the patch is now the session: the last commit made before the
  session began, through to the working tree. That covers both halves at once,
  everything committed during the session and everything still uncommitted.

  The session is dated from the birth time of the transcript the Stop payload
  names, since that file is created when the session is. Without one — no
  transcript, no birth time recorded by the filesystem, no commit before it, no
  repository — the hook falls back to `auto`, which is what it did before.

  `Overlock-Allow:` trailers consequently work at Stop time now, for commits the
  agent made during the session. Work still sitting in the tree still has no
  commit message to read, so the inline directive remains the only way to
  acknowledge that.

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
