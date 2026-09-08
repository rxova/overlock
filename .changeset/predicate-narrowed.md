---
'overlock': minor
---

Add `PREDICATE_NARROWED`, which watches the set an assertion ranges over rather
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
