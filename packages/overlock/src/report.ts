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
    return paint('✓ overlock: nothing weakened in this patch.', ANSI.green, color);
  }

  const lines: string[] = [];
  lines.push(
    paint(`overlock — ${summarize(report)}`, ANSI.bold, color) +
      paint(`  (${report.base})`, ANSI.dim, color),
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
  if (report.findings.length === 0) return 'overlock: clean.';

  const shown = report.findings.slice(0, limit);
  const hidden = report.findings.length - shown.length;

  const lines: string[] = [`overlock: ${summarize(report)}.`, ''];

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

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}...`;
}

export type { Finding };
