---
title: TEST_TIMEOUT_RAISED
description: A timeout or retry count went up, or appeared where there was none.
sidebar:
  order: 11
---

**Severity: `low`.**

```diff
- it('settles the batch', async () => {
+ it('settles the batch', async () => {
-   }, 5000);
+   }, 30000);
```

```
·  LOW  src/batch.test.ts:88  TEST_TIMEOUT_RAISED
     "timeout" raised from 5000 to 30000.
     -> Worth checking the test is slow rather than racy.
```

A test that needed five seconds and now needs thirty is either slower or less reliable, and those two have completely different fixes. Raising the number fixes the first one and hides the second one.

The hint is the entire content of this rule: **worth checking the test is slow rather than racy.** A racy test that passes at 30 seconds fails at 30 seconds eventually, usually in CI, usually on the day of a release. The extra time did not buy correctness, it bought a longer interval between failures.

## Keys it watches

`timeout`, `testTimeout`, `hookTimeout`, `retries`, `retry`, `maxRetries`.

Retries belong here for the same reason timeouts do. `retries: 3` turns a test that fails one run in four into a test that passes, and the failure it was reporting is still in the code.

## Introduced counts too

```
·  LOW  src/batch.test.ts:88  TEST_TIMEOUT_RAISED
     "retries" introduced at 3.
```

A retry count that appeared where there was none is the same edit as one that went up, and it is the version that shows up on a flaky test rather than a slow one. Only raises and introductions fire; lowering a timeout produces nothing.

## Why `low`

Because timeouts get tuned. A test that runs against a container is genuinely slower on a cold runner than on your laptop, and adjusting the number is maintenance, not decay.

At `low` it never fails a run by default, never blocks an agent, and shows up in the list where a reviewer can glance at it. If you want it to block — some repositories treat any retry as a bug — regrade it rather than lowering the bar for everything:

```bash
overlock --severity TEST_TIMEOUT_RAISED=high
```

See [severity](../learn/severity.md).

## In the ledger

`low` findings are counted separately from catches in [`overlock report`](../reference/ledger.md), under "Noted". A tool that counted this as a catch would report an impressive number and mean nothing by it.
