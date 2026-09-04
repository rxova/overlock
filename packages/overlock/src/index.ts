export { analyze, type AnalyzeOptions } from './analyze.js';
export { parseDiff, addedLines, removedLines } from './diff.js';
export {
  assertSafeRef,
  explainRange,
  hasCommits,
  rangeScope,
  resolveRange,
  untrackedDiff,
  untrackedFiles,
  type BaseMode,
  type RangeOptions,
  type ResolvedRange,
} from './git.js';
export { stopHookOutcome, parseStopPayload, type HookOutcome } from './hook.js';
export {
  AGENTS,
  HOOK_COMMAND,
  initClaude,
  initInstructions,
  instructionSnippet,
  mcpSnippet,
} from './init.js';
export {
  LATEST_PROTOCOL_VERSION,
  MessageBuffer,
  SUPPORTED_PROTOCOL_VERSIONS,
  TOOLS,
  handleMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcp.js';
export { appendLedger, ledgerPath, toEntry, type LedgerEntry } from './ledger.js';
export { BAR_DAYS, CATCH_BAR, meetsBar, readLedger, summarize, type Summary } from './summary.js';
export { isTestFile, isSnapshotFile, isThresholdConfig } from './paths.js';
export {
  compact,
  describeScope,
  EMPTY_PATCH_NOTE,
  human,
  isEmptyPatch,
  json,
  summaryText,
  useColor,
} from './report.js';
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
