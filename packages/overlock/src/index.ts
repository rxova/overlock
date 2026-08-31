export { analyze, type AnalyzeOptions } from './analyze.js';
export { parseDiff, addedLines, removedLines } from './diff.js';
export { untrackedDiff, untrackedFiles } from './git.js';
export { stopHookOutcome, parseStopPayload, type HookOutcome } from './hook.js';
export { AGENTS, HOOK_COMMAND, initClaude, initInstructions, instructionSnippet } from './init.js';
export { appendLedger, ledgerPath, toEntry, type LedgerEntry } from './ledger.js';
export { BAR_DAYS, CATCH_BAR, meetsBar, readLedger, summarize, type Summary } from './summary.js';
export { isTestFile, isSnapshotFile, isThresholdConfig } from './paths.js';
export { compact, human, json, summaryText, useColor } from './report.js';
export { applySuppressions, collectSuppressions, type Suppression } from './suppress.js';
export { RULES } from './rules/index.js';
export { run, type RunOptions, type RunResult } from './run.js';
export {
  RULE_IDS,
  type DiffFile,
  type DiffLine,
  type Evidence,
  type Finding,
  type Hunk,
  type Report,
  type RuleId,
  type Severity,
} from './types.js';
