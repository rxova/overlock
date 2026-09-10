---
title: Handling untrusted input
description: Everything overlock quotes was written by whoever wrote the patch, and it reaches a terminal, an agent and a PR comment.
sidebar:
  order: 2
---

overlock reads a patch and passes what it finds to three places that interpret text: a terminal, an agent's context, and a pull request comment.

Everything it quotes — evidence lines, test names, file paths — was written by whoever wrote the patch. On a fork PR, that is a stranger. So:

## A `--base` beginning with a dash is refused

`git diff --output=FILE` writes wherever it is pointed. `base` is reachable from the [MCP tool](../integrations/mcp.md) argument, from the [Action](../integrations/github-action.md) input and from the [config file](../reference/configuration.md), so a value beginning with a dash is rejected rather than handed to git as a flag.

## An unrecognised `--fail-on` fails closed

At `high`, rather than becoming a value that makes every severity comparison false — which would report `ok` on a patch carrying a `high` finding.

A gate given a value it does not understand has to fail closed. This is not hypothetical carefulness: it is a real shape of bug, and the failure is silent and permanent.

## Evidence, messages and paths are sanitised

Stripped of control characters and capped in length.

A terminal escape sequence in a test name can rewrite the verdict printed above it — a finding that says `✗ HIGH` becomes a line that says `✓` if the text after it moves the cursor. A backtick or a newline in a path breaks out of a code span in a pull request comment, and the rest of the comment is then whatever the patch author wanted to say in your bot's voice.

Both are cheap to do and neither is detectable after the fact, which is why the sanitising happens at the boundary rather than at each call site.

## Evidence is labelled as quoted content

Wherever it reaches an agent. The lines in a finding are code somebody else wrote, arriving in a context window alongside instructions — and a test file is an excellent place to put a sentence addressed to a model rather than to a compiler.

Labelling it does not make prompt injection impossible. It makes the boundary explicit, which is the part that is actually within a CLI's power.

## Symlinks are never followed out of the repository

Reading [untracked files](../learn/how-it-reads-a-patch.md#untracked-files-count) means reading paths git has not vetted. A symlink pointing at `~/.ssh/id_ed25519` is one `git add` away from being a file overlock would otherwise read and quote into a pull request comment.

## Nothing is ever written to the git index

overlock reads untracked files. It never stages them, never commits, never writes to `.git` at all. The only file it writes outside your explicit instruction is the [ledger](../reference/ledger.md), in your home directory, which records rule names and locations and never file contents — and `--no-ledger` turns that off.

`overlock init` writes files, because writing files is what you asked it to do, and it says which ones.

## What is not claimed

overlock is not a sandbox. It runs `git` as a subprocess in your repository with your permissions, and if a patch can make your git do something, overlock is not the thing standing in the way.

The claim is narrower and worth stating exactly: **text from the patch does not become a flag, a control sequence, or a formatting break in the three surfaces this tool prints to.**
