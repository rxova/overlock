import { BAR_DAYS, CATCH_BAR, meetsBar, type Summary } from './summary.js';
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

function severityColor(severity: Severity): string {
  if (severity === 'high') return ANSI.red;
  if (severity === 'medium') return ANSI.yellow;
  return ANSI.dim;
}

/** The terminal view: everything, grouped, with the evidence inline. */
export function human(report: Report, color: boolean): string {
  if (report.findings.length === 0) {
    return paint(
      `✓ overlock: nothing weakened in this patch.${suppressedNote(report)}`,
      ANSI.green,
      color,
    );
  }

  const lines: string[] = [];
  lines.push(
    paint(`overlock — ${summarize(report)}`, ANSI.bold, color) +
      paint(`  (${report.base})${suppressedNote(report)}`, ANSI.dim, color),
  );
  lines.push('');

  for (const f of report.findings) {
    const head = `${MARK[f.severity]} ${LABEL[f.severity]}`;
    lines.push(
      `${paint(head, severityColor(f.severity), color)}  ${f.file}:${f.line}  ${paint(
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
  if (report.findings.length === 0) return `overlock: clean.${suppressedNote(report)}`;

  const shown = report.findings.slice(0, limit);
  const hidden = report.findings.length - shown.length;

  const lines: string[] = [`overlock: ${summarize(report)}.${suppressedNote(report)}`, ''];

  for (const f of shown) {
    lines.push(`${MARK[f.severity]} ${LABEL[f.severity].trim()} ${f.file}:${f.line} ${f.rule}`);
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
