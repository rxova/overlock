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

Nine rules, all scoped strictly to the patch.

| Rule                         | Severity      | Fires when                                                                                                                         |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_REMOVED`               | high / medium | A test file is deleted or renamed out of the runner's glob; a case disappears from a surviving file                                |
| `TEST_SKIPPED_ADDED`         | high          | `it.skip`, `xit`, `.todo`, `@pytest.mark.skip`, `t.Skip()`, `#[ignore]`, `@Disabled` — and `.only`, which silences everything else |
| `ASSERTION_WEAKENED`         | high          | An exact matcher on a subject becomes an existence check on the same subject                                                       |
| `COVERAGE_THRESHOLD_LOWERED` | high          | A coverage or mutation threshold drops, or disappears                                                                              |
| `ASSERTION_REMOVED`          | medium        | A test file ends the patch with fewer assertions than it started with                                                              |
| `EXPECTED_VALUE_CHANGED`     | medium        | An assertion keeps its shape but its expected literal was edited                                                                   |
| `SNAPSHOT_UPDATED_WITH_CODE` | medium        | A snapshot was regenerated in the same patch as the code it snapshots                                                              |
| `TEST_TIMEOUT_RAISED`        | low           | A timeout or retry count went up, or appeared                                                                                      |
| `TEST_AND_IMPL_TOGETHER`     | low           | A test changed alongside the implementation it is named after                                                                      |

Only **high** blocks by default. The `low` tier exists because it is true often
enough that blocking on it would train you to uninstall the tool; it earns its
place by telling you which implementation change the other findings are about.

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

`fail-on`, `base`, `working-directory`, `version` and `comment` are all inputs;
`ok`, `findings` and `report` are outputs. The action never writes a ledger: that
file is a record of what your agents did on your machine, and a CI runner is
neither.

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
overlock --base main             # against a ref
overlock --json                  # the full report, for a script or an agent
overlock --compact               # the short form a phone can read
overlock --fail-on medium        # high | medium | low | none
overlock --test-glob '\.check\.ts$'
overlock --no-untracked             # ignore files git does not track yet
```

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` overlock
could not run.

`--base auto` (the default for the hook) works out what "this patch" means: your
uncommitted work if there is any, otherwise this branch's commits since it left
the default branch, otherwise the last commit.

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
