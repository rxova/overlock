import { assertionRemoved, assertionWeakened, expectedValueChanged } from './assertions.js';
import { snapshotUpdatedWithCode, testAndImplTogether } from './pairing.js';
import { testRemoved } from './removal.js';
import { testSkippedAdded } from './skip.js';
import { coverageThresholdLowered, testTimeoutRaised } from './thresholds.js';
import type { Rule } from './shared.js';

/** Registry order is report order for equal severities. */
export const RULES: Rule[] = [
  testRemoved,
  testSkippedAdded,
  assertionWeakened,
  assertionRemoved,
  expectedValueChanged,
  coverageThresholdLowered,
  snapshotUpdatedWithCode,
  testTimeoutRaised,
  testAndImplTogether,
];

export type { Rule, RuleContext } from './shared.js';
