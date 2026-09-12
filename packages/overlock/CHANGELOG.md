# overlock

## 0.9.0

### Minor Changes

- [#24](https://github.com/rxova/overlock/pull/24) [`d9858e3`](https://github.com/rxova/overlock/commit/d9858e3a4995e81ccbc8b3b124e22176c060e3c8) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Add an `exclude` setting: repository-root-relative paths left out of the patch the way `.overlock` already is, so another tool's evidence directory (`.basting`, `.saidso`) no longer changes the patch fingerprint on every turn, grows captured diffs recursively, or makes `auto` read the working tree. Excluded paths are absent from findings, file counts, base selection and snapshots, and the evaluation record carries the setting. Entries are literal prefixes; globs, pathspec magic, `..` and filesystem paths are refused.

## 0.8.0

### Minor Changes

- [#20](https://github.com/rxova/overlock/pull/20) [`5e91d3b`](https://github.com/rxova/overlock/commit/5e91d3b686aa3e8e77a81beaf9f891ec01356e4a) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Add opt-in repository evaluation records with portable sessions, exact patch fingerprints and snapshots, final hook decisions, and evidence before suppression. Exclude `.overlock` records from patch acquisition and scope. Add artifact import, independent outcome reviews, deduplicated evaluation reports, and corpus replay with separate detection and blocking oracles. Stop interpreting repeated legacy ledger detections as verified catches; the deprecated `meetsBar` now always returns false.

## 0.7.1

### Patch Changes

- [#18](https://github.com/rxova/overlock/pull/18) [`c7f6942`](https://github.com/rxova/overlock/commit/c7f6942d8aa9e3906fa69774f2c8d4158ba78065) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - `SUITE_SCOPE_NARROWED` no longer fires on a config file the patch creates.
  
  Read line by line, an added file is all gains and no losses — which is exactly
  the shape of an exclude list that grew. Every new package that arrived with a
  `vitest.config.ts` therefore read as a narrowed suite, at `high`, and blocked
  the merge.
  
  The trade: a config file that is _born_ narrow is no longer reported. There is
  no prior set to compare it against, so the alternative is firing on every new
  package, and a gate that does that is one people switch off. A file that already
  existed still fires, including when it gains an `exclude` key it never had.

## 0.7.0

### Minor Changes

- [#16](https://github.com/rxova/overlock/pull/16) [`5d87c3b`](https://github.com/rxova/overlock/commit/5d87c3ba5bebac3379ffcea033553fdb9dbcfef5) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Allow a rule to be graded `off`, in `severity` and on `--severity`.
  
  `severity` took `high`, `medium` and `low`, which left a repository that had
  read a rule enough to judge it says nothing here with two options: an inline
  directive per finding, or an allow trailer in every pull request. That is a lot
  of writing to repeat a decision already made — `TEST_AND_IMPL_TOGETHER` fires on
  ordinary test-driven work by design, and a repository can reasonably want it
  retired rather than acknowledged twenty-four times.
  
  ```json
  { "severity": { "TEST_AND_IMPL_TOGETHER": "off" } }
  ```
  
  `off` is a grade a rule can have, not a severity a finding can carry: no finding
  is ever reported as `off`, and `counts` keeps its three keys. What an `off` rule
  drops is counted in the new `silenced` field and printed beside the suppression
  count in the verdict line, on clean runs too — an escape hatch nobody can count
  is one that quietly empties the gate.
  
  Backwards compatible: existing configs and flags are unaffected.

- [#16](https://github.com/rxova/overlock/pull/16) [`5d87c3b`](https://github.com/rxova/overlock/commit/5d87c3ba5bebac3379ffcea033553fdb9dbcfef5) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Add `TEST_GATE_DISABLED` and `SUITE_SCOPE_NARROWED`, two rules that read the
  files deciding whether a suite runs at all rather than the files it is written
  in.
  
  A suite can be made to ask less than it did without any test file changing, and
  until now every one of these was silent:
  
  ```yaml
  - name: test
    run: pnpm test
  + continue-on-error: true
  ```
  
  ```json
  -  "test": "vitest run"
  +  "test": "vitest run || true"
  ```
  
  ```ts
  -  include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
  +  include: ['src/**/*.test.ts'],
  ```
  
  `TEST_GATE_DISABLED` covers the failure being made free: `continue-on-error:
  true` or `if: false` on a step that runs tests, a `|| true` / `|| exit 0` /
  `; true` after a test command, `--passWithNoTests`, and a test invocation
  deleted from a workflow with nothing in the patch running it instead. It is
  `high` when the diff shows what is being switched off and `medium` when it
  cannot — a `continue-on-error:` whose step the diff does not reach, or
  `--passWithNoTests`, which is legitimate in a package that genuinely has none.
  A command rewritten in place or a job moved between workflows is silent.
  
  `SUITE_SCOPE_NARROWED` covers the set the runner collects: an `include` or
  `testMatch` list that loses patterns or is replaced by a glob inside it, an
  `exclude` or `testPathIgnorePatterns` list that gains one, and a test command
  that gains a filter flag. The first of those is `PREDICATE_NARROWED` one level
  up — a runner's include list is the set the whole suite ranges over — and the
  mirror of the `TEST_REMOVED` case for a test file renamed out of the runner's
  glob: same outcome, glob moved off the file rather than file moved out of the
  glob. List changes are `high`; a filter flag is `medium`, because a suite split
  across two CI jobs and a suite cut in half look identical in a diff.
  
  Both read CI and runner config files only, so a marker in a test file or a
  `|| true` in prose is still nobody's finding.

## 0.6.1

### Patch Changes

- [#8](https://github.com/rxova/overlock/pull/8) [`d1668ba`](https://github.com/rxova/overlock/commit/d1668ba8c6ed4652d8e7c4d7f70c5efda17ce254) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Add a sewing machine SVG logo and refresh the README with centered branding, package badges, and quick links.

## 0.6.0

Not published to npm. `v0.6.0` was released as the GitHub Action alone — a
Marketplace listing fix, which touched `action.yml` and nothing under
`packages/` — and the package version was moved up to meet it so that the two
stop drifting. The next npm release is 0.6.1, and from there the action and the
package share one version line.

## 0.5.1

### Patch Changes

- [`c6fe117`](https://github.com/rxova/overlock/commit/c6fe11700d9280ebf995cc65f202352889584a48) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Neutral wording in the help text, the package description and the code
  comments, and a neutral placeholder name in the rename examples.
  
  No behaviour changes: the rules, their severities, the JSON schema and every
  flag are unchanged. `overlock --help` now opens with "report test-integrity
  findings in a git patch", `--compact` is described as the short form for small
  screens and hook output, and `init codex|cursor|copilot` says that an
  instruction is advisory where the Claude Code Stop hook can block a turn.
  
  The inferred-rename documentation and fixtures use `warehouserouting ->
  routing` in place of the previous placeholder.

## 0.5.0

### Minor Changes

- [`63c483b`](https://github.com/rxova/overlock/commit/63c483b941416b8ff0504754e09977055620acbd) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Add `PREDICATE_NARROWED`, which watches the set an assertion ranges over rather
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

- [`4193990`](https://github.com/rxova/overlock/commit/41939908667ebef7236f84ff6f8c1fef16950d3e) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Read assertions and test cases at the scale of the test, not the line.

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

- [`8a9e31f`](https://github.com/rxova/overlock/commit/8a9e31f8af03cdf438a314803b353b57c07d2fae) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Read `--base <ref>` as a fork point, and say what each run examined

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

- [`18a19db`](https://github.com/rxova/overlock/commit/18a19dbeb64d3ec5b6d4c99342c9e4aef13ff230) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Read settings from the repository, so the CLI, the hook and the action agree

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

- [`6956143`](https://github.com/rxova/overlock/commit/6956143b91e07a418e504da81e587af0d4713b77) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Let the Stop hook see what the agent committed

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

- [`1cd5c67`](https://github.com/rxova/overlock/commit/1cd5c676b92bed9f2b9c0928928fb8db3a88bd27) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Grade a deleted test file on what the patch does with its cases, and give it a
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

- [`80a658f`](https://github.com/rxova/overlock/commit/80a658f47e8dcb3a611472029695072be6157d05) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Answer the question a rename actually raises: what changed that it does not
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

- [`6eb6c3d`](https://github.com/rxova/overlock/commit/6eb6c3dafb1a9fa000cda1d3c9c9d2f393ea5c4c) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - See a weakened assertion the same commit's rename would have hidden.

  `ASSERTION_WEAKENED` and `EXPECTED_VALUE_CHANGED` pair a removed line with an
  added one by comparing their text, so a rename that lands in the subject broke
  the pair and the rule fired nothing at all:
  `expect(warehouserouting.total()).toBe(42)` becoming
  `expect(routing.total()).toBeDefined()` reported as silence. Both rules now pair
  against the pre-image with the patch's inferred substitution applied — the
  residual analysis can only mark findings that exist, and there was no finding to
  mark. Evidence still shows the lines as the patch wrote them.

- [`1d74600`](https://github.com/rxova/overlock/commit/1d74600c45396d2bc35edf12007f8e167744f19d) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - Move the test toolchain to the workspace root

  `vitest`, `@vitest/coverage-v8` and `@types/node` are declared once at the root
  instead of per package. Declaring them in both packages had them resolving
  vite's optional `esbuild` peer differently, which carried two full vite and
  vitest trees in the lockfile and a second esbuild download in every CI job.

  This is a development-time change only: devDependencies are never installed for
  consumers of the package, so nothing about the published build, its runtime
  dependencies or its public API changes.

## 0.1.0

### Minor Changes

- [`0704eb4`](https://github.com/rxova/overlock/commit/0704eb48ac04bc7d94339ca582a8c874db7ecd2b) Thanks [@jonatankruszewski](https://github.com/jonatankruszewski)! - First release.

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
