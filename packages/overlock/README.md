<p align="center">
  <img src="./assets/logo.svg" alt="overlock logo" width="180" />
</p>

<h1 align="center">overlock</h1>

<p align="center">Keep green tests honest.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/overlock"><img src="https://img.shields.io/npm/v/overlock?color=cb3837&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://github.com/rxova/overlock/actions/workflows/ci.yml"><img src="https://github.com/rxova/overlock/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://github.com/rxova/overlock/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/Node.js-%E2%89%A520.11-5fa04e?logo=nodedotjs&logoColor=white" alt="Node.js 20.11 or newer" /></a>
  <a href="https://github.com/rxova/overlock/blob/main/tsconfig.base.json"><img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript strict mode" /></a>
  <a href="https://github.com/rxova/overlock/blob/main/packages/overlock/package.json"><img src="https://img.shields.io/badge/dependencies-0-44cc11" alt="Zero runtime dependencies" /></a>
  <a href="https://github.com/rxova/overlock/blob/main/packages/overlock/vitest.config.ts"><img src="https://img.shields.io/badge/line%20coverage%20threshold-95%25%20per%20file-44cc11" alt="Line coverage threshold: 95% per file" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#agent-integration">Agent integration</a> ·
  <a href="#rules">Rules</a> ·
  <a href="#cli-reference">CLI reference</a>
</p>

A deterministic CLI that reads a git patch and reports edits that make a test
suite ask less than it did: skipped tests, removed or loosened assertions,
lowered coverage thresholds, narrowed test data.

It answers one question about a change:

> Did this change make the tests pass by weakening the tests?

There are no LLM calls, no network calls and no telemetry, and the package has
zero runtime dependencies, so `npx overlock` on a cold cache is a single small
download.

Source and issue tracker: <https://github.com/rxova/overlock>.

```console
$ npx overlock
overlock — 2 findings (2 high)  (HEAD)

✗ HIGH  src/auth.test.ts:42  TEST_SKIPPED_ADDED
     .skip added — this test no longer runs.
     + it.skip('rejects expired tokens', async () => {
     -> Make the test pass, or delete it deliberately and say why.

✗ HIGH  vitest.config.ts:18  COVERAGE_THRESHOLD_LOWERED
     Threshold "statements" lowered from 95 to 40.
     - statements: 95,
     + statements: 40,
     -> Raise the number back and make the code meet it.
```

## Install

Run it against the current working tree without installing anything:

```bash
npx overlock
```

Or install it as a dev dependency:

```bash
npm install --save-dev overlock
pnpm add -D overlock
```

Requires Node.js 20.11 or newer.

## Agent integration

```bash
npx overlock init claude
```

`init claude` writes a committed `.claude/settings.json` containing a `Stop`
hook. The hook runs overlock when the agent tries to end its turn and blocks the
turn while a finding at or above the configured threshold stands.

The file is committed rather than written to `~/.claude/settings.json` because
Claude Code cloud sessions do not read the home directory: hooks there come from
the repository, from organisation-managed settings, or from a plugin. Committing
it also means collaborators inherit the same hook.

At `Stop` time the patch covers everything the agent committed since the session
began plus whatever it left in the working tree, because agents commonly commit
before stopping.

`init codex`, `init cursor` and `init copilot` append an instruction to the
instruction file each of those agents reads. An instruction is advisory — unlike
the Claude Code hook, it cannot stop a turn.

`init` also prints the [MCP server](#mcp-server) snippet.

## Rules

Thirteen rules, all scoped to the patch.

| Rule                         | Severity      | Fires when                                                                                                                                                               |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TEST_REMOVED`               | high / medium | A test file is deleted or renamed out of the runner's glob; a case disappears from a surviving file                                                                      |
| `TEST_GATE_DISABLED`         | high / medium | The suite stops gating the build: `continue-on-error: true` on a test step, `\|\| true` after a test command, `--passWithNoTests`, or the job that ran the tests deleted |
| `TEST_SKIPPED_ADDED`         | high          | `it.skip`, `xit`, `.todo`, `@pytest.mark.skip`, `t.Skip()`, `#[ignore]`, `@Disabled` — and `.only`, which silences everything else                                       |
| `ASSERTION_WEAKENED`         | high          | An assertion stops naming a value: `toBe(3)` becomes `toBeDefined()`, `toBeTruthy()` or `not.toBeNull()`                                                                 |
| `ASSERTION_NARROWED`         | high          | An assertion keeps naming a value but covers less of it: a whole object becomes one field                                                                                |
| `PREDICATE_NARROWED`         | high / medium | The set an assertion ranges over shrinks: a filter gains a condition, an iterated source gains a `.filter(...)`, a case table loses rows, a named exclusion list grows   |
| `SUITE_SCOPE_NARROWED`       | high / medium | The set the runner collects shrinks: an include glob narrowed, an include list losing patterns, an exclude list growing, a test command gaining a filter                 |
| `COVERAGE_THRESHOLD_LOWERED` | high          | A coverage or mutation threshold drops, or disappears                                                                                                                    |
| `ASSERTION_REMOVED`          | medium        | A test file ends the patch with fewer assertions than it started with                                                                                                    |
| `EXPECTED_VALUE_CHANGED`     | medium        | An assertion keeps its shape but its expected literal was edited                                                                                                         |
| `SNAPSHOT_UPDATED_WITH_CODE` | medium        | A snapshot was regenerated in the same patch as the code it snapshots                                                                                                    |
| `TEST_TIMEOUT_RAISED`        | low           | A timeout or retry count went up, or appeared                                                                                                                            |
| `TEST_AND_IMPL_TOGETHER`     | low           | A test changed alongside the implementation it is named after                                                                                                            |

Only `high` fails a run by default. `medium` findings are reported for review.
`low` findings are context: `TEST_AND_IMPL_TOGETHER` in particular fires on
ordinary test-driven work, and is useful mainly for identifying which
implementation change the other findings relate to.

Test files are recognised by the conventions of TypeScript, JavaScript, Python,
Go, Rust, Java, Kotlin, Ruby and C#. `--test-glob <regex>` adds more.

### Regrading a single rule

`--severity TEST_REMOVED=medium` changes the grade of one rule and leaves the
rest alone. This is separate from `--fail-on` on purpose: lowering `--fail-on`
to `medium` to unblock one rule also unblocks every other `high` rule.

`--severity PREDICATE_NARROWED=high` collapses that rule's two grades into one
if the `medium` case should also block.

`--severity TEST_AND_IMPL_TOGETHER=off` switches a rule off entirely. It is the
right answer for a rule a repository has read enough of to judge it says nothing
here — `TEST_AND_IMPL_TOGETHER` fires on ordinary test-driven work by design, and
a repository that has decided so should not have to write an inline directive per
finding to say it again. What an `off` rule drops is counted and reported:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (9 silenced by config)
```

`off` is a grade a rule can have, not a severity a finding can carry: no finding
is ever reported as `off`, and `counts` keeps its three keys.

## How findings are graded

### Weakened, narrowed, and neither

`ASSERTION_WEAKENED` covers an assertion that stops naming a value:
`toBe('admin')` becoming `toBeDefined()`, `toBeTruthy()`, `toBeFalsy()`,
`toBeInstanceOf(...)`, a bare `toHaveBeenCalled()`, an `expect.any(...)` where a
literal was, or `not.toBeNull()`, which asserts presence and nothing about the
value.

`toBeNull()`, `toBeUndefined()` and `toBe(false)` are not treated as weakenings.
Each names exactly one value, as precisely as `toBe(3)` does.

`ASSERTION_NARROWED` covers an assertion that keeps naming a value but covers
less of it: `expect(row).toEqual({ id, state, lapsedAt })` becoming
`expect(row.lapsedAt).toBeNull()`, or `toHaveBeenCalledWith('row', 42)` becoming
`toHaveBeenCalledWith('row')`.

Both are evaluated per test case rather than per line. A case that loses
specificity on one line while gaining assertions elsewhere is graded `medium`
and the finding says how many it gained; a case that only lost stays `high`. A
removal is paired only with an addition in the same edit — not one three context
lines away in the next case — and is not paired at all when the assertion it
removed still appears further down the file.

### Deleted test files

`TEST_REMOVED` on a deleted file is graded on whether the cases it held reappear
anywhere else in the same patch:

```
✗ HIGH  apps/web/app.test.tsx  TEST_REMOVED
     Test file deleted — 33 of 37 cases reappear elsewhere in this patch.
     4 did not: refuses a PDF larger than the store will take, cannot be given
     an amount that is not a number, formats the amount as US dollars while it
     is typed, keeps the row open when the period has been emptied
```

Every case re-homed grades the finding `medium`; any case missing keeps it
`high` and names the missing ones. Deleting the module a file is named after —
`api.test.ts` alongside `api.ts` — also grades it `medium`. A module that was
only modified does not.

A case is matched by its title, by its title with the patch's own rename applied
(`lists ledger entries` becoming `lists admin entries` is not a deletion), and
failing both, by its body.

When every case in a deleted file lands in one other file, that is treated as a
move, and several moves are reported as a single finding:

```
!  MED  src/old/ledger.test.ts  TEST_REMOVED
     8 test files deleted — all 63 of their cases reappear elsewhere in this
     patch: src/old/ledger.test.ts -> src/admin/api.test.ts, ...
```

Matching is a heuristic. A case found again by name is not a guarantee that it
still asserts what it did; it grades the finding and points at where to look.

### `PREDICATE_NARROWED`

This is the one rule that can fire on a patch where every `expect` is byte for
byte unchanged. It watches the set the assertions are applied to: a
`.filter(...)` predicate that gained a conjunct, an iterated source that gained
a `.filter(...)` or a `.slice(...)`, an `it.each([...])` table that lost rows,
or a list whose name indicates it holds exemptions growing by one.

It is `high` when the narrowed set is consumed by a `for...of`, a `.forEach` or
an `it.each`, because that set decides how many times the assertions below it
run. It is `medium` when the set is only assigned to a variable, because a diff
cannot establish whether that variable reaches an assertion.

### The suite's own gate

`TEST_GATE_DISABLED` and `SUITE_SCOPE_NARROWED` are the only two rules that read
a file with no assertions in it. They watch the workflow that invokes the runner
and the config that tells the runner what to collect, because a suite can be
made to ask less without any test file changing at all:

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

The last one is `PREDICATE_NARROWED` one level up: a runner's include list is the
set the whole suite ranges over, and narrowing it is the same edit as narrowing
the set an `it.each` consumes. It is also the mirror of the `TEST_REMOVED` case
that catches a test file renamed out of the runner's glob — same outcome, glob
moved off the file rather than the file moved out of the glob.

`TEST_GATE_DISABLED` is `high` when the diff shows what it is switching off — a
neutralised test command, or a `continue-on-error:` in a hunk that names a test
step — and `medium` when the diff cannot show which step a disabler belongs to,
or when the change is `--passWithNoTests`, which is legitimate in a package that
genuinely has no tests. A test invocation that disappears from a workflow is
`high` only when nothing else in the patch runs it: a job moved between
workflows, or a command rewritten in place, is silent.

`SUITE_SCOPE_NARROWED` is `high` when a runner config's include list loses
patterns or its exclude list gains them, because the file says outright what the
runner collects. It is `medium` when a test command gains a filter flag
(`--project`, `-k`, `--testPathPattern`), because a suite split across two CI
jobs and a suite cut in half look identical in a diff.

## Renames and reformatting

A large rename makes every line it touches look edited, producing one true but
uninformative finding per line. overlock infers the substitution from the patch
itself and reports what the substitution does not account for:

```
overlock — 293 findings (293 low)  (origin/main)

  rename detected  warehouserouting -> routing  (607 files, 6 casings)
    293 findings consistent with it
    0 unexplained

293 findings the patch itself accounts for, not listed. `--json` has all of them.
```

A name that became two names is read as one rename with two targets, since
splitting one concept in two is a common refactor. Each target has to clear the
recurrence bar on its own. A name that became more than two things is treated as
edited rather than renamed.

Whatever is left unexplained is printed in full and clustered by the name most
of it mentions:

```
  22 of 25 unexplained findings mention cloud_sync
    Read that change once and most of this list goes with it.
```

The same machinery recognises pure reformatting: a file whose only delta is
whitespace produces no findings, and a shortened name that let a formatter
re-join a wrapped import is still read as one substitution.

Inference never changes a verdict. An explained finding keeps its severity,
still counts, and still fails the run if it was going to; the inference only
changes the order things are presented in. Repeated findings are collapsed
wherever they are printed — the same edit in twenty files is one row with a
count.

## Suppressing findings

Both forms require a named rule and a written reason. There is no wildcard, and
every suppression is counted and reported, including on otherwise clean runs:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (1 suppressed)
```

### Inline directive

Put a comment on the offending line, or on the line directly above it:

```ts
// overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412
it.skip('rejects expired tokens', () => {
```

A directive with no reason silences nothing, an unknown rule ID silences
nothing, and a directive appearing inside a string literal is ignored. One
directive covers one rule on one line in one file.

Some findings have no line to sit on — a deleted test file is reported against a
path that no longer has a line 1. Name the path instead, from any line the patch
still has:

```ts
// overlock-ignore TEST_REMOVED src/api.test.ts -- module deleted; cases re-homed here
```

A directive naming a path covers only the findings in that path that carry no
line of their own, so it cannot blanket-silence a rule across a file.

**A directive added by the patch itself stops the Stop hook once.** It still
silences the finding, but the hook stops and quotes the claim back:

```
overlock: this patch silenced 1 of its own findings.

! src/auth.test.ts:42 TEST_SKIPPED_ADDED
   overlock-ignore ... -- flaky

If that is right, say so and finish. If not, fix the cause.
```

The hook never stops twice for the same directive, so the next turn continues. A
directive that was already in the tree passes without comment.

### Commit or pull request trailer

For a change too broad to annotate line by line, put a trailer in the commit
message or the pull request body:

```
Overlock-Allow: TEST_AND_IMPL_TOGETHER -- rename only, no behaviour changed
```

What it names can be as narrow as a single finding:

```
Overlock-Allow: TEST_REMOVED src/api.test.ts -- the whole file moved
Overlock-Allow: TEST_REMOVED src/api.test.ts:42 -- one finding, by line
Overlock-Allow: TEST_REMOVED "src/api.test.ts::rejects expired tokens" -- ported to tokens.test.ts
```

The quoted form names a case rather than a line, which survives lines being
added above it.

A trailer that matches nothing is reported rather than ignored:

```
  ! allowed nothing: TEST_REMOVED src/api.test.ts::rejects expired tokens -- ported to tokens.test.ts
    The finding it names is not in this patch.
```

At `Stop` time a trailer covers what the agent committed during the session.
Work still in the working tree has no commit message to read, which is why
trailers complement the inline directive rather than replacing it.

## Untracked files

Files git has not seen yet are included by default and rendered as additions.
`git diff HEAD` reports nothing about an untracked file, so without this a new
test file that arrives already skipped would produce no findings.

`--no-untracked` opts out. `--staged` never includes them, since that mode asks
what the index holds. overlock reads untracked files but never stages them, and
never writes to the git index.

## CLI reference

```bash
overlock [check]                          # the current patch
overlock --staged                         # only what is staged
overlock --base main                      # against where this branch left main
overlock --base main --base-mode direct   # against main's tip itself
overlock --explain-base                   # say how the base was chosen, then run
overlock --fail-on-empty                  # exit 1 if the resolved patch is empty
overlock --json                           # the full report
overlock --compact                        # the short form
overlock --fail-on medium                 # high | medium | low | none
overlock --severity TEST_REMOVED=medium   # high | medium | low | off, repeatable
overlock --allow-file pr-body.txt         # read Overlock-Allow trailers from a file
overlock --test-glob '\.check\.ts$'       # extra test-file pattern, repeatable
overlock --limit 5                        # findings shown in --compact
overlock --cwd path/to/pkg                # run against another directory
overlock --no-untracked                   # ignore files git does not track yet
overlock --no-ledger                      # do not record this run
overlock --config <file>                  # read settings from this file
overlock --no-config                      # ignore overlock.config.json entirely
overlock config                           # the settings in force, and where from
overlock report [--days N]                # what the ledger has recorded
overlock init <agent>                     # claude | codex | cursor | copilot
overlock mcp                              # run as an MCP server on stdio
```

Exit codes: `0` nothing at or above `--fail-on`, `1` findings at or above it,
`2` overlock could not run.

### How the base is chosen

`--base auto`, the default, resolves in order: uncommitted work if there is any,
otherwise this branch's commits since it left the default branch, otherwise the
last commit. It is the default for the CLI, the Stop hook and the MCP tool
alike, so that a run immediately after the agent committed still sees those
commits.

`--base <ref>` means the fork point — `<ref>...HEAD`, what this branch did since
it left `<ref>`. It is deliberately not `git diff <ref>`, which compares that
ref's tip against the working tree: once the ref moves ahead, every file it
gained reads as a deletion. `--base-mode direct` requests the literal
comparison.

Every verdict states what it examined — `83 files, 3 commits, against 492b7ad`.
A range that turned out to hold nothing is reported as empty rather than as a
pass; `--fail-on-empty` turns that into exit 1. `--explain-base` prints how the
base was chosen.

## Configuration file

`overlock.config.json` beside `package.json` — or an `overlock` key inside
`package.json` — is read by the CLI, the Stop hook and the GitHub Action alike,
so the same patch resolves the same way locally and in CI:

```json
{
  "base": "origin/main",
  "baseMode": "fork-point",
  "failOn": "high",
  "failOnEmpty": false,
  "severity": { "TEST_REMOVED": "medium", "TEST_AND_IMPL_TOGETHER": "off" },
  "testGlob": ["\\.check\\.ts$"],
  "untracked": true
}
```

A flag overrides the file. The nearest declaration at or above the working
directory applies, so a package in a monorepo can carry its own settings.
`--config <file>` points at one directly; `--no-config` skips the search.

An unknown setting or an invalid value stops the run with exit 2 rather than
being ignored.

`overlock config` prints what is in force and where each value came from:

```
overlock: /repo/overlock.config.json
  base = "origin/main"  (config)
  baseMode = "fork-point"  (default)
  failOn = "low"  (flag)
```

## JSON output

The JSON schema is the API. Rule IDs are frozen: adding a rule is a minor
release, changing what an existing ID means is a breaking one.

```json
{
  "schema": 1,
  "ok": false,
  "base": "HEAD",
  "counts": { "high": 1, "medium": 0, "low": 0 },
  "findings": [
    {
      "id": "TEST_SKIPPED_ADDED:src/auth.test.ts:42",
      "rule": "TEST_SKIPPED_ADDED",
      "severity": "high",
      "file": "src/auth.test.ts",
      "line": 42,
      "message": ".skip added — this test no longer runs.",
      "evidence": { "after": "it.skip('rejects expired tokens', async () => {" },
      "fix_hint": "Make the test pass, or delete it deliberately and say why."
    }
  ]
}
```

`line` is `null` when a finding is about a file rather than a line in it, and
`id` is then `<rule>:<file>` with no line suffix.

`explained_by` is present when the rest of the patch accounts for the change —
for example `"warehouserouting -> routing"` or `"reformatting only"`. The report
also carries `renames`, `explained` and `allowed` alongside `findings`.

`silenced` counts findings a rule graded `off` dropped, next to `suppressed` for
the ones a directive silenced. Both are reported on clean runs too: a gate that
empties quietly is not a gate.

## Programmatic use

```ts
import { analyze } from 'overlock';

const report = analyze({ diff: myUnifiedDiff, failOn: 'medium' });
```

`analyze` takes a unified diff and returns the same report the CLI serialises.
`RULE_IDS` is exported alongside it.

## MCP server

```json
{
  "mcpServers": {
    "overlock": { "command": "npx", "args": ["-y", "overlock", "mcp"] }
  }
}
```

Two tools: `overlock_check` and `overlock_report`. `overlock_check` returns the
compact report, and the full JSON only when there is something to act on, so a
clean run costs one line rather than a serialised empty report.

The server implements MCP over stdio directly rather than through
`@modelcontextprotocol/sdk`, to keep the package free of runtime dependencies.
Protocol version strings are taken from the official SDK's constants, and
negotiation echoes the client's version when it is one overlock recognises.

## GitHub Action

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5
    with: { fetch-depth: 0 }
  - uses: rxova/overlock@v0
```

On a pull request the action diffs against the base commit rather than
`github.sha`, which on a pull request is the merge commit and would report
nothing. It posts a single findings comment and edits it in place on later
pushes.

The comment leads with what fails the run, and with the inferred rename when
there is one; everything else is grouped by rule inside a `<details>` block.

Inputs: `base`, `fail-on`, `severity`, `comment`, `working-directory`,
`version`, `cli-path`, `github-token`. Outputs: `ok`, `findings`, `report`,
`fail-on`.

The action never writes a ledger, since that file records what agents did on a
developer's machine.

The CLI is installed once per job and then invoked as a local file. The analysis
itself takes seconds; most of a slow run is npm, so pinning `version` to an
exact release lets the runner's npm cache hit, where `latest` has to resolve
against the registry every time.

## The ledger

Every run appends one line to `~/.overlock/ledger.jsonl`: timestamp, repository,
branch, which rules fired, and whether the run failed. It records rule, severity
and location only — never file contents, since the evidence lines in a finding
are source code.

`--no-ledger` turns it off; the `OVERLOCK_LEDGER` environment variable moves it.

`overlock report` reads it back:

```console
$ overlock report
overlock — 30 days, 3 repos, 60 runs

  Caught           10   runs with a high or medium finding
  Blocked           5   times an agent was stopped
  Suppressed        5   findings silenced with a reason
  Noted             3   runs with low findings only

By rule
  ASSERTION_WEAKENED             5  ████████████████████████
  COVERAGE_THRESHOLD_LOWERED     2  ██████████
  TEST_SKIPPED_ADDED             2  ██████████

Context only
  TEST_AND_IMPL_TOGETHER         6
```

`--days <n>` moves the window and `--json` returns the aggregate as data.
`report` always exits 0 — it reports history and gates nothing.

Low findings are counted separately from catches. `TEST_AND_IMPL_TOGETHER` fires
on ordinary test-driven work and would otherwise dominate the totals, so catches
count `high` and `medium` only.

## Handling of untrusted input

overlock reads a patch and passes what it finds to a terminal, an agent and a
pull request comment. Everything it quotes was written by whoever wrote the
patch, so:

- A `--base` value beginning with a dash is refused. `git diff --output=FILE`
  writes wherever it is pointed, and `base` is reachable from the MCP tool
  argument.
- An unrecognised `--fail-on` value fails closed at `high` rather than making
  every comparison false.
- Evidence, messages and paths are stripped of control characters and capped in
  length, so a terminal escape sequence in a test name cannot rewrite the
  verdict printed above it and a backtick or newline in a path cannot break out
  of a code span in a pull request comment.
- Evidence is labelled as quoted content wherever it reaches an agent.
- Symlinks are never followed out of the repository, and nothing is ever written
  to the git index.

## Scope

overlock reads a patch for a specific class of edit — the ones that make a test
suite ask less — and reports them deterministically, so the result can be used
as a gate.

It is not a linter, a code reviewer, or a scope or plan checker. It does not
run your tests, evaluate whether the implementation is correct, or use a model
to judge intent. A finding is a statement about the diff and nothing more.

## Contributing

See [CONTRIBUTING.md](https://github.com/rxova/overlock/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/rxova/overlock/blob/main/LICENSE)
