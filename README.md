# Overlock

> The published package lives in [`packages/overlock`](packages/overlock).



**Find out what your coding agent did to your tests.**

> An overlock stitch binds a raw seam edge so it cannot fray.
> This does the same to a test suite.

An agent that cannot make a test pass has a second option: make the test stop
asking. It adds `it.skip`, it swaps `toBe(3)` for `toBeDefined()`, it edits the
expected value to whatever the code now returns, it lowers a coverage threshold.
Then it reports success, truthfully as far as its summary goes.

`overlock` reads the diff the agent just made and answers one question:

> Did this change make the tests pass by weakening the tests?

Deterministic. No LLM calls, no network, no telemetry. Zero runtime
dependencies, so `npx overlock` on a cold cache is one small download — which
matters when something runs it on every turn.

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

## Why it exists, and why it works from a phone

You can start agent work from anywhere now. You cannot _verify_ it from
anywhere: a 400-line diff is unreadable on a six-inch screen, so you either
merge on trust or park everything until you are back at a laptop. The agent's
summary is the one artifact you can actually read on a phone, and it is exactly
the artifact that will not mention a weakened assertion.

Installed as a Claude Code Stop hook, `overlock` makes that self-report
falsifiable. The agent cannot end its turn claiming success while a HIGH finding
stands, and the reason it gets back is written to be read one-handed.

At Stop time the patch is the session: everything the agent committed since the
session began, plus whatever it left in the working tree. Agents commit and then
stop, so a hook that read only uncommitted work saw nothing in the ordinary
case — which is a strange blind spot for a tool whose whole subject is what your
coding agent did to your tests.

## Install

```bash
# Run it once, right now, against your working tree
npx overlock

# Or wire it into your agent
npx overlock init claude
```

`init claude` writes a **committed** `.claude/settings.json`. That is
deliberate, and it is the detail everything else depends on: Claude Code cloud
sessions — the ones you start from a phone — do not read `~/.claude/settings.json`.
Hooks there come from the repository, from organisation-managed settings, or
from a plugin. A hook installed into your home directory works perfectly at your
desk and does nothing in the one place you most need it.

`init codex`, `init cursor` and `init copilot` append an instruction to the file
each agent reads. That is weaker than a hook and it says so: an instruction can
be forgotten once the context window fills. Claude Code is the one that can
actually be stopped.

## What it looks for

Ten rules, all scoped strictly to the patch.

| Rule                         | Severity      | Fires when                                                                                                                         |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_REMOVED`               | high / medium | A test file is deleted or renamed out of the runner's glob; a case disappears from a surviving file                                |
| `TEST_SKIPPED_ADDED`         | high          | `it.skip`, `xit`, `.todo`, `@pytest.mark.skip`, `t.Skip()`, `#[ignore]`, `@Disabled` — and `.only`, which silences everything else |
| `ASSERTION_WEAKENED`         | high          | An assertion stops naming a value: `toBe(3)` becomes `toBeDefined()`, `toBeTruthy()` or `not.toBeNull()`                           |
| `ASSERTION_NARROWED`         | high          | An assertion keeps naming a value but covers less of it: a whole object becomes one field                                          |
| `COVERAGE_THRESHOLD_LOWERED` | high          | A coverage or mutation threshold drops, or disappears                                                                              |
| `ASSERTION_REMOVED`          | medium        | A test file ends the patch with fewer assertions than it started with                                                              |
| `EXPECTED_VALUE_CHANGED`     | medium        | An assertion keeps its shape but its expected literal was edited                                                                   |
| `SNAPSHOT_UPDATED_WITH_CODE` | medium        | A snapshot was regenerated in the same patch as the code it snapshots                                                              |
| `TEST_TIMEOUT_RAISED`        | low           | A timeout or retry count went up, or appeared                                                                                      |
| `TEST_AND_IMPL_TOGETHER`     | low           | A test changed alongside the implementation it is named after                                                                      |

Only **high** blocks by default. The `low` tier exists because it is true often
enough that blocking on it would train you to uninstall the tool; it earns its
place by telling you which implementation change the other findings are about.

`--severity TEST_REMOVED=medium` regrades one rule without touching the rest. It
exists because the alternative — dropping `--fail-on` to `medium` to unblock one
rule — also unblocks `TEST_SKIPPED_ADDED`, `ASSERTION_WEAKENED` and
`COVERAGE_THRESHOLD_LOWERED`. An escape from one rule should not disarm four.

### Weakened, narrowed, and what is neither

Two different things happen to an assertion, and being told the wrong one costs
you the time it takes to work out the right one for yourself.

`ASSERTION_WEAKENED` is the assertion giving up the value: `toBe('admin')`
becoming `toBeDefined()`, `toBeTruthy()`, `toBeFalsy()`, `toBeInstanceOf(...)`,
a bare `toHaveBeenCalled()`, an `expect.any(...)` where a literal was — or
`not.toBeNull()`, which says a value is there and nothing about what it is.

`toBeNull()`, `toBeUndefined()` and `toBe(false)` are **not** in that family.
Each names exactly one value, as precisely as `toBe(3)` does, and reading them
as existence checks is how two of three findings on one real patch came back
wrong.

`ASSERTION_NARROWED` is the assertion keeping the value and covering less of it:
`expect(row).toEqual({ id, state, lapsedAt })` becoming
`expect(row.lapsedAt).toBeNull()`, or `toHaveBeenCalledWith('row', 42)` becoming
`toHaveBeenCalledWith('row')`. Same severity, different sentence, and the
sentence is the part you act on.

Both are read at the scale of the test rather than the line. A case that gives
up specificity on one line while gaining assertions elsewhere is graded `medium`
and says how many it gained; a case that only lost stays `high`. And a removal
is paired only with an addition in the same edit — never one three context lines
away in the next test — and never at all when the assertion it removed is still
standing further down the file.

### What a deleted test file is graded on

`TEST_REMOVED` on a deleted file asks the question a reviewer is actually
asking — _did any coverage go with it?_ — by matching the case names the file
lost against every case name the patch adds, anywhere in it:

```
✗ HIGH  apps/web/app.test.tsx  TEST_REMOVED
     Test file deleted — 33 of 37 cases reappear elsewhere in this patch.
     4 did not: refuses a PDF larger than the store will take, cannot be given
     an amount that is not a number, formats the amount as US dollars while it
     is typed, keeps the row open when the period has been emptied
```

Every name re-homed grades it `medium`; some missing keeps it `high` and names
them. Deleting the module the file is named after — `api.test.ts` alongside
`api.ts` — also grades it `medium`, because deleting a feature deletes its
tests. A module that was merely _modified_ does not: a test file deleted while
the code it covered lives on is the case worth stopping for.

A case is matched by its title, by its title with the patch's own rename applied
— `lists ledger entries` becoming `lists admin entries` is not a deletion — and
failing both, by its body. The body is the one that matters in practice: a
retitled test is the commonest thing a deleted-case finding gets wrong, and a
case is what it asserts rather than what it is called.

When every case in a deleted file lands in one other file, that is a move, and
several moves are reported as one finding:

```
!  MED  src/old/ledger.test.ts  TEST_REMOVED
     8 test files deleted — all 63 of their cases reappear elsewhere in this
     patch: src/old/ledger.test.ts -> src/admin/api.test.ts, ...
```

One decision, one finding, one acknowledgement. Reported per file it was eight
of each, and a reviewer who has waved through six is not reading the seventh.

Matching is a heuristic and is meant as one: a case found again by name is not a
promise that it still asserts what it did. It grades the finding and tells you
where to look. It does not replace you.

Languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby and C#
conventions are recognised out of the box. `--test-glob` adds your own.

## As an MCP tool

```console
$ overlock init claude     # also prints the MCP snippet
```

Or add it to `.mcp.json` yourself:

```json
{
  "mcpServers": {
    "overlock": { "command": "npx", "args": ["-y", "overlock", "mcp"] }
  }
}
```

Two tools: `overlock_check` and `overlock_report`. The check tool returns the
compact report, plus the full JSON only when there is something to act on — a
clean run costs one line rather than a serialised empty report.

The server is spoken by hand rather than through
`@modelcontextprotocol/sdk`. MCP over stdio is newline-delimited JSON-RPC 2.0
with five methods, which is less code than the argument for adding a runtime
dependency to a package an agent runs on every turn. Protocol versions are taken
from the official SDK's own constants, and negotiation echoes the client's
version when it is one overlock knows.

## In CI

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v5
    with: { fetch-depth: 0 }
  - uses: rxova/overlock@v0
```

On a pull request it diffs against the base commit — not `github.sha`, which on
a PR is the merge commit and would report nothing — and posts a single findings
comment, edited in place on later pushes rather than appended to. A bot that
comments again on every push buries the review it is meant to support.

The comment leads with what blocks; everything that does not is grouped by rule
and folded into a `<details>`, because a flat table that gives a blocking
`TEST_REMOVED` the same weight as six `TEST_AND_IMPL_TOGETHER` rows makes you do
the sorting the tool already did.

The comment leads with the rename when there is one. `fail-on`, `severity`, `base`,
`working-directory`, `version` and `comment` are all inputs;
`ok`, `findings` and `report` are outputs. The action never writes a ledger: that
file is a record of what your agents did on your machine, and a CI runner is
neither.

The CLI is installed once per job and then invoked as a local file. The
analysis itself takes seconds; almost all of a slow run is npm, so pinning
`version` to an exact release lets the runner's npm cache hit, where `latest`
has to ask the registry what that means every time.

## When the patch is a rename

A rename touching six hundred files makes every line it touches look edited.
Each finding is true, and none of them is what a reviewer wants: their question
is _what changed that the rename does not explain?_

overlock infers the substitution from the patch itself and answers that
question directly:

```
overlock — 293 findings (293 low)  (origin/main)

  rename detected  trainmotherfoca -> trainmf  (607 files, 6 casings)
    293 findings consistent with it
    0 unexplained

293 findings the patch itself accounts for, not listed. `--json` has all of them.
```

Three lines instead of 293, and strictly more informative — the absence of
anything else is an explicit claim rather than something you verify by reading
a table. Whatever the substitution does _not_ account for is printed in full,
above the fold.

A name that became two names is read as one thing too. `cloud_sync` splitting
into `cloud_backup` and `multi_device` is an ordinary refactor, and a tool that
insists a rename has exactly one target reports it as a wall of unrelated
findings — one patch came back with twenty-five unexplained, twenty-two of which
were that split seen twenty-two times. Each branch still has to be attested on
its own, and a name that became five different things is being edited rather
than renamed, which nothing explains.

Whatever is left over is clustered by the name most of it mentions:

```
  22 of 25 unexplained findings mention cloud_sync
    Read that change once and most of this list goes with it.
```

The same machinery sees through a formatter: a name that got thirteen
characters shorter lets prettier re-join an import that no longer needs
wrapping, and a file whose only delta is whitespace is not a change in any
sense the rules mean.

**What this deliberately does not do is decide anything.** An explained finding
keeps its severity, still counts, and still blocks if it was going to. The
inference is a heuristic, and a patch big enough to establish a rename is a
patch big enough to hide one real edit inside — so a rename is never a reason
the gate stops gating. It changes what you read first, not what you are told.

Repeated findings are collapsed wherever they are printed. The same edit in
twenty files is one row with a count, not twenty rows.

## Acknowledging a whole patch

The inline directive is the right shape for a finding about a line. It is the
wrong shape for a rename, where using it means adding twenty comments to source
files and deleting them again — worse than the noise it silences.

Put a trailer in the commit message, or in the pull request body:

```
Overlock-Allow: TEST_AND_IMPL_TOGETHER -- rename only, no behaviour changed
```

Same ceiling as everywhere else: a named rule and a written reason, never a
wildcard across rules. It is reported and counted like any other suppression,
and the Stop hook quotes it back at you once, because a trailer is written by
the patch by definition.

What it names can be as narrow as the finding, which matters when a file holds
seventeen of them and fifteen are explained:

```
Overlock-Allow: TEST_REMOVED src/api.test.ts -- the whole file moved
Overlock-Allow: TEST_REMOVED src/api.test.ts:42 -- one finding, by line
Overlock-Allow: TEST_REMOVED "src/api.test.ts::rejects expired tokens" -- ported to tokens.test.ts
```

The quoted form names the case rather than the line, because a line number moves
when someone adds a line above it and a test title does not. Fifteen cases
acknowledged one by one leaves the two nobody has explained still standing,
which is the point — a directive that names the file silences all seventeen,
including the one that turns out never to have landed.

And an acknowledgement that covers nothing is reported rather than quietly doing
nothing:

```
  ! allowed nothing: TEST_REMOVED src/api.test.ts::rejects expired tokens -- ported to tokens.test.ts
    The finding it names is not in this patch.
```

Either the case came back or it never landed where the trailer said it did.
Both are worth a sentence; neither is worth a clean run that stands silently on
a claim nobody checked.

At Stop time it covers what the agent committed during the session; work still
sitting in the tree has no commit message to read — which is why this is an
addition to the inline directive and not a replacement for it.

## Silencing a finding

Sometimes a skip is deliberate — a test quarantined behind a real bug, waiting
on a fix you have already written down somewhere. Put a comment on the offending
line, or the line directly above it:

```ts
// overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412
it.skip('rejects expired tokens', () => {
```

The rule ID and the reason are **both required**. A directive with no written
reason silences nothing, an unknown rule ID silences nothing, there is no
wildcard, and one quoted inside a string literal is documentation rather than
permission. A suppression covers one rule on one line in one file.

Some findings have no line to sit on. A deleted test file is the case: it is
reported against a path that no longer has a line 1, so there is nowhere to put
the comment. Name the path instead, from any line the patch still has — the
replacement test file, most often:

```ts
// overlock-ignore TEST_REMOVED src/api.test.ts -- module deleted; cases re-homed here
```

That is not a wildcard either: a directive naming a path covers only the
findings in it that carry no line of their own, so it can never blanket-silence
a rule across a file. It works at Stop time as well as in CI, which is why it is
a directive rather than a commit trailer — when the hook runs, the work is
usually still uncommitted and there is no commit message to read; a trailer in
a commit the agent made during the session is read.

**A directive the patch itself added stops the Stop hook once.** It still
silences the finding, but the agent cannot reach a silent exit 0 by writing its
own permission slip — the hook stops and quotes the claim back to you:

```
overlock: this patch silenced 1 of its own findings.

! src/auth.test.ts:42 TEST_SKIPPED_ADDED
   overlock-ignore ... -- flaky

If that is right, say so and finish. If not, fix the cause.
```

Accept it and the next turn continues; the hook never stops twice. A directive
that was already in the tree records a decision somebody made and reviewed, so
it passes in silence.

That friction is the design. A gate with no escape hatch gets uninstalled the
first time it is wrong; a gate with a frictionless one gets suppressed everywhere
and stops meaning anything — which is why `eslint-disable` eventually needed a
lint rule of its own to police it. Requiring a named rule and a sentence of
justification keeps the hatch usable by a person explaining themselves and
useless to an agent looking for the shortest path to green.

Every run reports how many findings were suppressed, including clean ones:

```console
$ overlock
✓ overlock: nothing weakened in this patch. (1 suppressed)
```

The count goes into the ledger too. An escape hatch nobody can count is one that
quietly empties the gate.

## Untracked files

Files git has not seen yet are included by default, rendered as additions.

This matters more than it sounds: `git diff HEAD` reports nothing whatsoever
about an untracked file, so before this existed a brand-new test file arriving
already skipped passed completely clean — and creating a test file is the most
ordinary thing an agent does. `--no-untracked` opts out; `--staged` never
includes them, because the question it asks is specifically what the index holds.

overlock reads those files, it never stages them. `git add -N` would have been
the shorter fix and it writes to the index of a repository this tool promised
only to read.

## Usage

```bash
overlock [check]                 # the current patch
overlock --staged                # only what is staged
overlock --base main             # against where this branch left main
overlock --base main --base-mode direct   # against main's tip itself
overlock --explain-base          # say how the base was chosen, then run
overlock --fail-on-empty         # exit 1 if the resolved patch holds nothing
overlock --json                  # the full report, for a script or an agent
overlock --compact               # the short form a phone can read
overlock --fail-on medium        # high | medium | low | none
overlock --severity TEST_REMOVED=medium   # regrade one rule, repeatable
overlock --allow-file pr-body.txt         # read Overlock-Allow trailers from a file
overlock --test-glob '\.check\.ts$'
overlock --no-untracked             # ignore files git does not track yet
overlock config                  # the settings in force, and where from
```

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` overlock
could not run.

`--base auto` — the default — works out what "this patch" means: your
uncommitted work if there is any, otherwise this branch's commits since it left
the default branch, otherwise the last commit. It is the default for the check,
the hook and the MCP tool alike, because a gate that runs right after the agent
committed is exactly the moment the working tree is empty and the commits are
the whole patch.

`--base <ref>` means the fork point — `<ref>...HEAD`, what this branch did since
it left `<ref>`. It is not `git diff <ref>`, which compares that ref's tip to
your working tree: the moment the ref moves ahead, every file it gained reads as
a deletion here, and a test file among them is reported as `TEST_REMOVED` at
HIGH on a branch that never touched it. `--base-mode direct` asks for the
literal comparison, for the callers that want it.

Every verdict says what it examined — `83 files, 3 commits, against 492b7ad` —
and a range that turned out to hold nothing is reported as such rather than as a
pass. `--fail-on-empty` turns that into exit 1; `--explain-base` prints how the
base was chosen, which is the quickest way to find out why a run saw less than
you expected.

## Repository settings

One repository, one answer. `overlock.config.json` beside your `package.json` —
or an `overlock` key inside it — is read by the CLI, the Stop hook and the
GitHub action alike, so the same patch cannot pass locally and block in CI with
nothing to point at:

```json
{
  "base": "origin/main",
  "baseMode": "fork-point",
  "failOn": "high",
  "failOnEmpty": false,
  "severity": { "TEST_REMOVED": "medium" },
  "testGlob": ["\\.check\\.ts$"],
  "untracked": true
}
```

A flag always wins over the file — the file is the default, not a cage. The
nearest declaration at or above the working directory is the one that applies,
so a package in a monorepo can have its own answer. `--config <file>` points at
one directly; `--no-config` ignores the search entirely.

An unknown setting or a bad value stops the run with exit 2. A `failon` typo
that silently did nothing would leave you certain a rule was graded down and
finding out otherwise from a blocked merge, which is the failure this file
exists to remove.

`overlock config` prints what is in force and where each value came from:

```
overlock: /repo/overlock.config.json
  base = "origin/main"  (config)
  baseMode = "fork-point"  (default)
  failOn = "low"  (flag)
```

## The JSON contract

The schema is the API. Rule IDs are frozen — adding a rule is a minor release,
changing what an existing ID means is a breaking one.

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

`line` is `null` when the finding is about the file rather than a line in it —
a deleted test file has no line 1 to send you to — and `id` is then
`<rule>:<file>` with no line suffix.

`explained_by` is present when the rest of the patch accounts for the change —
`"trainmotherfoca -> trainmf"` or `"reformatting only"`. The report also
carries `renames`, `explained` and `allowed` alongside `findings`.

## Programmatic use

```ts
import { analyze } from 'overlock';

const report = analyze({ diff: myUnifiedDiff, failOn: 'medium' });
```

## The ledger

Every run appends one line to `~/.overlock/ledger.jsonl`: timestamp, repo,
branch, which rules fired, and whether the run actually blocked. It exists to
answer one question after a month of use — _how many times did my agent weaken a
test that I would have merged without noticing?_

It records rule, severity and location. It never records file contents: the
evidence lines in a finding are your source code, and a ledger that accumulated
them would be a copy of your repository sitting in your home directory.

`--no-ledger` turns it off; `OVERLOCK_LEDGER` moves it.

## Reading the ledger back

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

Bar: 4+ catches in 30 days. 10 caught — met.
```

`--days <n>` moves the window, `--json` gives you the aggregate as data, and it
always exits 0 — this reports history, it does not gate anything.

**Low findings are not catches.** `TEST_AND_IMPL_TOGETHER` fires on ordinary
test-driven work and would otherwise be the most common finding every month,
which would let the tool clear its own bar on noise. Catches count high and
medium only; low findings are listed separately as context.

The bar itself was written down before any of this was built, so the result
could not be read the way it was wanted: **four real catches in thirty days, and
zero false blocks annoying enough to switch it off.** Only the first half is
measurable from a log. The second half is reported as a question rather than a
score, because a tool that graded itself on both halves would be marking its own
homework.

## Notes on trust

overlock reads a patch and hands what it finds to a terminal, an agent and a
pull request comment. Everything it quotes is written by whoever wrote the
patch, so:

- **Refs are refs.** A `--base` that starts with a dash is refused. `git diff
--output=FILE` writes wherever it is pointed, and `base` is reachable from the
  MCP tool argument — so without that check, anything able to call the tool
  could overwrite a file as you.
- **An unknown `--fail-on` fails closed**, at `high`, rather than making every
  comparison false and passing everything.
- **Evidence, messages and paths are stripped of control characters and capped.**
  A test name carrying an erase-line sequence would otherwise rewrite the verdict
  printed above it; a backtick or newline in a path would break out of the code
  span in a pull request comment.
- **Evidence is labelled as quoted content** where it reaches an agent, because
  a test name is attacker-controlled text arriving in a context window.
- **Symlinks are never followed** out of the repository, and nothing is ever
  written to the git index.

## What it is not

Not a linter — ESLint already reviews your code, and
[`eslint-plugin-vibe-proof`](https://www.npmjs.com/package/eslint-plugin-vibe-proof)
does it with agents in mind. Not a code reviewer — CodeRabbit and Greptile own
the human review moment on the PR page. Not a scope gate —
[`agent-guardrails`](https://www.npmjs.com/package/agent-guardrails) checks a
change against a declared plan.

`overlock` does one thing those do not: it reads the patch for the specific
edits that buy a green check, and it is deterministic enough to sit in a hook
and block on the result.

## License

MIT

## Working on this repository

```bash
pnpm install
pnpm exec turbo run build   # tsup, ESM, with .d.ts
pnpm test                   # unit suite, coverage thresholds enforced per file
pnpm run e2e                # drives the built binary against real git repos
pnpm run verify             # the pre-push gate: the same list CI runs
```

Commits follow Conventional Commits (enforced by commitlint on the branch, the
pushed commit, and the PR title, since the title becomes the squash subject).
A change to the published package needs a changeset: `pnpm changeset`.

CI runs `overlock` against its own pull requests. A tool that gates other
people's test edits has no business exempting its own.
