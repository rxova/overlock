# Security policy

## Supported versions

The latest published `0.x` release on npm is the supported version. Fixes are
released forward; there are no long-term support branches.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it through GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**
(<https://github.com/rxova/overlock/security/advisories/new>).

Include the version, the environment, and the smallest input that reproduces the
problem — a diff, a config file, a commit trailer or an MCP request as
appropriate.

You can expect an acknowledgement within a few days. A confirmed issue will be
fixed in a patch release and credited in the advisory unless you ask otherwise.

## Threat model

overlock reads a git patch and the repository's own configuration, and passes
what it finds to a terminal, an agent's context window and a pull request
comment. Everything it quotes is written by whoever wrote the patch, so patch
content is treated as untrusted input:

- `--base` values beginning with a dash are refused, since `git diff` accepts
  options such as `--output=FILE` and `base` is reachable from the MCP tool
  argument.
- An unrecognised `--fail-on` value fails closed at `high`.
- Evidence, messages and paths are stripped of control characters and capped in
  length.
- Evidence is labelled as quoted content wherever it reaches an agent.
- Symlinks are never followed out of the repository.
- Nothing is ever written to the git index or to the files being analysed.

Findings in scope include: reading or writing a file outside the repository,
executing patch-controlled input, escaping a terminal or Markdown context via
report output, and any path by which a crafted patch causes the gate to report
clean when it should not.

Out of scope: the tool declining to fire on a weakening it does not model. That
is a false negative — please open a normal issue for it.
