import { BAR_DAYS, CATCH_BAR, meetsBar, type Summary } from './summary.js';
import { EMPTY_TREE } from './git.js';
import type { Finding, Report, Severity } from './types.js';

const MARK: Record<Severity, string> = { high: '✗', medium: '!', low: '·' };
const LABEL: Record<Severity, string> = { high: 'HIGH', medium: 'MED ', low: 'LOW ' };

const ANSI = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  bold: '\u001B[1m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  green: '\u001B[32m',
} as const;

/**
 * Colour is opt-out via NO_COLOR and opt-in via a TTY, so piping into a file or
 * into an agent's context never smuggles escape codes into the payload.
 */
export function useColor(stream: { isTTY?: boolean | undefined }, env: NodeJS.ProcessEnv): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') return true;
  return stream.isTTY === true;
}

function paint(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${ANSI.reset}` : text;
}

/**
 * Where to go and look. A finding with no line renders as the bare path: a
 * deleted file has nothing at line 1, and printing `api.test.ts:1` sends a
 * reviewer looking for something that is not there.
 */
function where(f: Finding): string {
  return f.line === null ? f.file : `${f.file}:${f.line}`;
}

function severityColor(severity: Severity): string {
  if (severity === 'high') return ANSI.red;
  if (severity === 'medium') return ANSI.yellow;
  return ANSI.dim;
}

/**
 * Findings that are the same edit seen in several places, collapsed.
 *
 * Keyed on the rule and the evidence rather than the message, because the
 * message names the file and the whole point is that the file is not the
 * interesting part. Twenty rows saying `trainmotherfoca` became `trainmf` are
 * one fact; printing them twenty times is how a patch of any size stops being
 * readable.
 */
interface Group {
  first: Finding;
  files: string[];
  count: number;
}

export function groupFindings(findings: Finding[]): Group[] {
  const groups = new Map<string, Group>();

  for (const f of findings) {
    const key = [f.rule, f.severity, f.evidence.before ?? '', f.evidence.after ?? ''].join(
      '\u0000',
    );
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { first: f, files: [f.file], count: 1 });
      continue;
    }
    group.count += 1;
    if (!group.files.includes(f.file)) group.files.push(f.file);
  }

  return [...groups.values()];
}

/** At most this many paths named before a group is summarised by its count. */
const MAX_PATHS = 3;

function groupWhere(group: Group): string {
  if (group.count === 1) return where(group.first);
  const shown = group.files.slice(0, MAX_PATHS).join(', ');
  const rest = group.files.length - Math.min(group.files.length, MAX_PATHS);
  return `${shown}${rest > 0 ? `, and ${rest} more` : ''}  (${group.count})`;
}

/**
 * Words that appear in every assertion ever written, and so cluster nothing.
 *
 * The matchers are matched by shape rather than listed, because the list grows
 * with every test framework and a missed one would top the chart in a patch
 * that used it.
 */
const VOCABULARY = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'await',
  'async',
  'this',
  'new',
  'import',
  'export',
  'from',
  'true',
  'false',
  'null',
  'undefined',
  'it',
  'test',
  'describe',
  'def',
  'func',
  'self',
  'value',
  'result',
  'data',
]);

const MATCHER = /^(?:to[A-Z]|expect$|assert|should$|not$)/;

function identifiersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const token of text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) {
    if (VOCABULARY.has(token) || MATCHER.test(token)) continue;
    found.add(token);
  }
  return found;
}

/** Below this a shared name is a coincidence, not a change. */
const MIN_CLUSTER = 3;

/**
 * The one identifier most of these findings are about, when there is one.
 *
 * "25 unexplained" reads as 25 things to check. When 22 of them name
 * `cloud_sync` they are one change seen 22 times, and the difference between
 * those two readings is the difference between triaging a patch in a glance and
 * reading every row to discover that. It is stated as a count and never acted
 * on: this groups the list, it does not shorten it.
 */
export function sharedIdentifier(findings: Finding[]): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const f of findings) {
    const text = `${f.evidence.before ?? ''}\n${f.evidence.after ?? ''}`;
    for (const name of identifiersIn(text)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (count < MIN_CLUSTER || count * 2 < findings.length) continue;
    if (best === null || count > best.count) best = { name, count };
  }
  return best;
}

/**
 * Acknowledgements that silenced nothing, said out loud.
 *
 * A trailer is a claim about a finding — "this case was ported, that rename is
 * deliberate". When the finding it names is not in the patch the claim has
 * outlived whatever it was written for, and the one thing a reviewer must not
 * conclude from a clean run is that every line of it was still true.
 */
function staleLines(report: Report, color: boolean): string[] {
  if (report.allowances_unused.length === 0) return [];

  const lines = report.allowances_unused.map((a) =>
    paint(
      `  ! allowed nothing: ${a.rule}${a.target === null ? '' : ` ${a.target}`} -- ${a.reason}`,
      ANSI.yellow,
      color,
    ),
  );
  return [...lines, paint('    The finding it names is not in this patch.', ANSI.dim, color)];
}

/**
 * What the rest of the patch already accounts for, as a claim rather than a
 * table.
 *
 * This is the block a reviewer actually reads on a rename: three lines that say
 * what the patch is and, crucially, that nothing else is hiding in it. The
 * absence of anything unexplained is the finding.
 */
function renameBlock(report: Report, color: boolean): string[] {
  if (report.renames.length === 0) return [];

  const lines: string[] = [];
  for (const rename of report.renames) {
    const casings = rename.casings === 1 ? '' : `, ${rename.casings} casings`;
    lines.push(
      paint(
        `  rename detected  ${rename.from} -> ${rename.to}  (${rename.files} files${casings})`,
        ANSI.bold,
        color,
      ),
    );
  }

  const unexplained = report.findings.length - report.explained;
  lines.push(paint(`    ${report.explained} findings consistent with it`, ANSI.dim, color));
  lines.push(
    paint(`    ${unexplained} unexplained`, unexplained === 0 ? ANSI.green : ANSI.yellow, color),
  );
  lines.push('');

  return lines;
}

/**
 * What a run examined, for the line that reports it.
 *
 * A verdict without this is the same sentence whether the patch held 83 files
 * or none, which is how a wrong base stays invisible until CI disagrees.
 */
export function describeScope(report: Report): string {
  const parts: string[] = [];
  const scope = report.scope;
  if (scope) {
    parts.push(`${scope.files} file${scope.files === 1 ? '' : 's'}`);
    if (scope.commits > 0) parts.push(`${scope.commits} commit${scope.commits === 1 ? '' : 's'}`);
  }
  parts.push(`against ${describeBase(report.base)}`);
  return parts.join(', ');
}

/** True when the resolved range held nothing, so nothing was examined. */
export function isEmptyPatch(report: Report): boolean {
  return report.scope?.files === 0 && report.findings.length === 0;
}

/**
 * Said out loud rather than reported as a pass, because an empty patch and a
 * clean patch are the same green line and only one of them means anything.
 */
export const EMPTY_PATCH_NOTE = 'nothing to examine — the resolved patch is empty';

/** The terminal view: everything, grouped, with the evidence inline. */
export function human(report: Report, color: boolean): string {
  if (report.findings.length === 0) {
    if (isEmptyPatch(report)) {
      return [
        paint(
          `! overlock: ${EMPTY_PATCH_NOTE} (${describeScope(report)}).${suppressedNote(report)}`,
          ANSI.yellow,
          color,
        ),
        ...staleLines(report, color),
      ].join('\n');
    }
    return [
      paint(
        `✓ overlock: nothing weakened in this patch.${suppressedNote(report)}`,
        ANSI.green,
        color,
      ) + paint(`  (${describeScope(report)})`, ANSI.dim, color),
      ...staleLines(report, color),
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(
    paint(`overlock — ${summarize(report)}`, ANSI.bold, color) +
      paint(`  (${describeScope(report)})${suppressedNote(report)}`, ANSI.dim, color),
  );
  lines.push('');
  lines.push(...staleLines(report, color));
  lines.push(...renameBlock(report, color));

  const unexplained = report.findings.filter((f) => f.explained_by === undefined);

  const cluster = sharedIdentifier(unexplained);
  if (cluster !== null) {
    lines.push(
      paint(
        `  ${cluster.count} of ${unexplained.length} unexplained findings mention ${cluster.name}`,
        ANSI.bold,
        color,
      ),
      paint('    Read that change once and most of this list goes with it.', ANSI.dim, color),
      '',
    );
  }

  for (const group of groupFindings(unexplained)) {
    const f = group.first;
    const head = `${MARK[f.severity]} ${LABEL[f.severity]}`;
    lines.push(
      `${paint(head, severityColor(f.severity), color)}  ${groupWhere(group)}  ${paint(
        f.rule,
        ANSI.dim,
        color,
      )}`,
    );
    lines.push(`     ${f.message}`);
    if (f.evidence.before) lines.push(paint(`     - ${f.evidence.before}`, ANSI.red, color));
    if (f.evidence.after) lines.push(paint(`     + ${f.evidence.after}`, ANSI.green, color));
    lines.push(paint(`     -> ${f.fix_hint}`, ANSI.dim, color));
    lines.push('');
  }

  // Stated, never silently dropped: the inference is a heuristic, and a count
  // nobody can see is one nobody can distrust.
  if (report.explained > 0) {
    lines.push(
      paint(
        `${report.explained} finding${report.explained === 1 ? '' : 's'} the patch itself ` +
          'accounts for, not listed. `--json` has all of them.',
        ANSI.dim,
        color,
      ),
    );
  }

  return lines.join('\n').trimEnd();
}

/**
 * The phone view, and the one that matters most.
 *
 * This string is what a Claude Code Stop hook hands back as `blockStopReason`,
 * which means it reaches the person through the agent's own message on a
 * six-inch screen. So: a verdict line, then at most three findings, each one
 * line of location and one line of evidence. Everything else is a pointer back
 * to the full run. Long evidence is clipped here and only here — the JSON keeps
 * the untruncated text.
 */
export function compact(report: Report, limit = 3): string {
  if (isEmptyPatch(report)) {
    return `overlock: ${EMPTY_PATCH_NOTE} (${describeScope(report)}).${suppressedNote(report)}${staleNote(report)}`;
  }
  if (report.findings.length === 0) {
    return `overlock: clean — ${describeScope(report)}.${suppressedNote(report)}${staleNote(report)}`;
  }

  const unexplained = report.findings.filter((f) => f.explained_by === undefined);
  const groups = groupFindings(unexplained);
  const shown = groups.slice(0, limit);
  const hidden = groups.length - shown.length;

  const lines: string[] = [`overlock: ${summarize(report)}.${suppressedNote(report)}`, ''];

  const rename = report.renames[0];
  if (rename !== undefined) {
    lines.push(
      `rename ${rename.from} -> ${rename.to} explains ${report.explained} of them; ` +
        `${report.findings.length - report.explained} unexplained.`,
      '',
    );
  }

  // One line, because on a phone it is the line that decides whether the list
  // below is one change or twenty-five.
  const cluster = sharedIdentifier(unexplained);
  if (cluster !== null) {
    lines.push(`${cluster.count} of ${unexplained.length} of them mention ${cluster.name}.`, '');
  }

  for (const group of shown) {
    const f = group.first;
    lines.push(`${MARK[f.severity]} ${LABEL[f.severity].trim()} ${groupWhere(group)} ${f.rule}`);
    lines.push(`   ${f.message}`);
    const evidence = f.evidence.after ?? f.evidence.before;
    if (evidence) {
      const prefix = f.evidence.after ? '+' : '-';
      lines.push(`   ${prefix} ${clip(evidence, 100)}`);
    }
  }

  if (hidden > 0) {
    lines.push('', `...and ${hidden} more. Run \`npx overlock check\` for the full list.`);
  }

  for (const a of report.allowances_unused) {
    lines.push('', `! allowed nothing: ${a.rule}${a.target === null ? '' : ` ${a.target}`}`);
  }

  return lines.join('\n');
}

export function json(report: Report): string {
  return JSON.stringify(report, null, 2);
}

function summarize(report: Report): string {
  const parts: string[] = [];
  if (report.counts.high > 0) parts.push(`${report.counts.high} high`);
  if (report.counts.medium > 0) parts.push(`${report.counts.medium} medium`);
  if (report.counts.low > 0) parts.push(`${report.counts.low} low`);
  const total = report.findings.length;
  return `${total} finding${total === 1 ? '' : 's'} (${parts.join(', ')})`;
}

/**
 * Suppressions are always shown, even on a clean run. A silenced finding that
 * leaves no trace in the output is how a gate ends up passing everything.
 */
/** The empty-tree hash is git's answer, not an answer a person can read. */
function describeBase(base: string): string {
  if (base === EMPTY_TREE) return 'no commits yet';
  if (base === '--cached') return 'staged';
  return base;
}

/**
 * The phone form of the same warning. Two words, because the alternative is a
 * clean line that quietly stands on a claim nobody checked.
 */
function staleNote(report: Report): string {
  const stale = report.allowances_unused.length;
  if (stale === 0) return '';
  return ` (${stale} acknowledgement${stale === 1 ? '' : 's'} matched nothing)`;
}

function suppressedNote(report: Report): string {
  if (report.suppressed === 0) return '';
  return ` (${report.suppressed} suppressed)`;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

export type { Finding };

/**
 * The ledger, read back.
 *
 * Deliberately a handful of numbers rather than a dashboard: this is read once
 * a month to answer one question, and every extra row is a place for the answer
 * to hide.
 */
/** Rules that never block, kept out of the headline chart. */
const LOW_RULES = new Set<string>(['TEST_AND_IMPL_TOGETHER', 'TEST_TIMEOUT_RAISED']);

export function summaryText(summary: Summary, color: boolean): string {
  const window = summary.days === undefined ? 'all time' : `${summary.days} days`;

  if (summary.runs === 0) {
    return [
      paint(`overlock — nothing recorded in ${window}.`, ANSI.bold, color),
      '',
      paint('  Install the hook and leave it on:  overlock init claude', ANSI.dim, color),
      paint('  The ledger only fills while something is running it.', ANSI.dim, color),
    ].join('\n');
  }

  const lines: string[] = [];
  const repos = `${summary.repos} repo${summary.repos === 1 ? '' : 's'}`;
  lines.push(
    paint(`overlock — ${window}, ${repos}, ${summary.runs} runs`, ANSI.bold, color),
    '',
    row('Caught', summary.caught, 'runs with a high or medium finding', color),
    row('Blocked', summary.blocked, 'times an agent was stopped', color),
    row('Suppressed', summary.suppressed, 'findings silenced with a reason', color),
    row('Noted', summary.noted, 'runs with low findings only', color),
  );

  // Low-severity rules are listed under their own heading rather than mixed in.
  // TEST_AND_IMPL_TOGETHER fires on ordinary test-driven work and would
  // otherwise top the chart every month and bury everything that matters.
  const real = summary.byRule.filter((r) => !LOW_RULES.has(r.rule));
  const context = summary.byRule.filter((r) => LOW_RULES.has(r.rule));

  if (real.length > 0) {
    const widest = real[0]?.count ?? 1;
    lines.push('', paint('By rule', ANSI.dim, color));
    for (const { rule, count } of real) {
      const bar = '█'.repeat(Math.max(1, Math.round((count / widest) * 24)));
      lines.push(
        `  ${rule.padEnd(28)}${String(count).padStart(4)}  ${paint(bar, ANSI.dim, color)}`,
      );
    }
  }

  if (context.length > 0) {
    lines.push('', paint('Context only', ANSI.dim, color));
    for (const { rule, count } of context) {
      lines.push(paint(`  ${rule.padEnd(28)}${String(count).padStart(4)}`, ANSI.dim, color));
    }
  }

  if (summary.byRepo.length > 1) {
    lines.push('', paint('By repository', ANSI.dim, color));
    for (const { repo, caught } of summary.byRepo) {
      lines.push(`  ${shorten(repo, 40).padEnd(42)}${String(caught).padStart(4)}`);
    }
  }

  const met = meetsBar(summary);
  lines.push(
    '',
    paint(`Bar: ${CATCH_BAR}+ catches in ${BAR_DAYS} days.`, ANSI.dim, color) +
      ' ' +
      paint(
        met ? `${summary.caught} caught — met.` : `${summary.caught} caught — not met yet.`,
        met ? ANSI.green : ANSI.yellow,
        color,
      ),
    paint('The other half of the bar — whether it ever blocked you wrongly', ANSI.dim, color),
    paint('enough to switch it off — only you can answer.', ANSI.dim, color),
  );

  return lines.join('\n');
}

function row(label: string, value: number, note: string, color: boolean): string {
  return `  ${label.padEnd(14)}${String(value).padStart(5)}   ${paint(note, ANSI.dim, color)}`;
}

/** Keeps the tail of a path, which is the part that identifies the repository. */
function shorten(path: string, max: number): string {
  if (path.length <= max) return path;
  return `...${path.slice(-(max - 3))}`;
}
