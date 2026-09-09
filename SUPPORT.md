# Support

- **A rule fired on a change that weakened nothing, or stayed quiet on one that
  did?** Open a
  [rule accuracy report](https://github.com/rxova/overlock/issues/new?template=false_positive.yml).
  This is the most useful thing you can file.
- **Something else broken?** Open a
  [bug report](https://github.com/rxova/overlock/issues/new?template=bug_report.yml).
- **Missing rule, flag or config key?** Open a
  [feature request](https://github.com/rxova/overlock/issues/new?template=feature_request.yml).
- **Security issue?** Follow [SECURITY.md](./SECURITY.md) — please do not open a
  public issue.
- **Usage question, or not yet a concrete bug?**
  [Discussions](https://github.com/rxova/overlock/discussions).

Before filing, check whether the behaviour is already documented. Three sections
of the [README](./README.md) answer most of what gets reported:

- [How findings are graded](./README.md#how-findings-are-graded) — why a
  weakening is `high` in one patch and `medium` in another, and which assertions
  are deliberately not treated as weakenings.
- [Renames and reformatting](./README.md#renames-and-reformatting) — why a large
  rename produces one finding per line, and what `explained_by` means.
- [Scope](./README.md#scope) — what overlock does not try to be. A finding is a
  statement about the diff and nothing more.

## Filing a good report

A rule is a pure function of the diff, so the diff is the whole reproduction. A
report that carries the patch can be turned into a failing test; one that
describes it usually cannot.

- **The patch**, reduced to the smallest diff that still shows the behaviour.
- **The version** — `overlock --version`.
- **The command you ran**, including `--base`, `--fail-on` and any `--severity`
  overrides. The base decides what is in the patch at all, and a surprising
  result is often a surprising base — `--explain-base` prints how it was chosen.
- **`--json` output** rather than the terminal rendering, when the question is
  about a specific finding. It carries the fields the compact view leaves out.
- **What you expected instead**, and why: for a false positive, what the change
  actually did; for a false negative, what the test can no longer catch.
- **The config in force** — `overlock config` prints each value and where it came
  from, which is shorter than describing your setup.

If the finding involves a language other than TypeScript or JavaScript, say
which. Test-file recognition and the assertion patterns differ per language, and
a rule that works in one may simply not model the other yet.

## Version support

The latest published `0.x` release is the supported version. Fixes are released
forward; there are no long-term support branches.

Rule IDs are frozen. Adding a rule is a minor release, changing what an existing
ID means is a breaking one, and the `--json` schema is the API — see
[JSON output](./README.md#json-output).
