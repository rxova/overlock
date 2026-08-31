---
'overlock': minor
---

Add `overlock report`, which reads the ledger back.

The ledger existed to answer one question after a month of use — _how many times
did my agent weaken a test that I would have merged without noticing?_ — and
until now nothing read it, so the file just accumulated.

```console
$ overlock report --days 30
```

Reports runs, catches, blocks and suppressions, broken down by rule and by
repository, and states whether the pre-registered bar was met.

Low-severity findings deliberately do not count as catches.
`TEST_AND_IMPL_TOGETHER` fires on ordinary test-driven work and would otherwise
be the most common finding every month, which would let the tool clear its own
bar on noise. They are listed separately as context.

`--days <n>` moves the window, `--json` emits the aggregate as data, and the
command always exits 0 — it reports history rather than gating anything.
