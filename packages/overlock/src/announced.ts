import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Report, RuleId } from './types.js';

/**
 * What the Stop hook has already put in front of a person.
 *
 * The hook stops once for a claim the patch wrote about itself. "Once" needs a
 * memory that outlives the process: `stop_hook_active` is set only on the Stop
 * that directly follows a blocked one, so every later turn arrives with it
 * false, and a hook deciding from that alone stops again on every turn for a
 * directive nobody has changed since.
 *
 * It lives beside the legacy ledger rather than in the repository: the hook
 * runs on every turn, and a gate that grew an untracked directory in the tree
 * it is reviewing would be writing itself into the patch.
 */
export interface Announcement {
  ts: string;
  repo: string;
  branch: string;
  /** Kept plainly, as the ledger keeps rule names: it names no source. */
  rule: RuleId;
  /** The claim itself, hashed — a written reason is a line of the source. */
  key: string;
}

/** Where a claim was made, which is what scopes the memory. */
export interface ClaimScope {
  repo: string;
  branch: string;
}

export interface SuppressionMemory {
  /** Claim keys already quoted back to a person in this scope. */
  seen: ReadonlySet<string>;
  /** Records the claims a stop quoted, so the next turn does not repeat them. */
  remember: (claims: readonly Claim[]) => void;
}

export interface Claim {
  rule: RuleId;
  key: string;
}

export function announcedPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OVERLOCK_ANNOUNCED;
  if (override) return override;
  return join(env.OVERLOCK_HOME ?? join(homedir(), '.overlock'), 'announced.jsonl');
}

/**
 * The claims a report would quote back, one key each.
 *
 * The line a directive sits on is deliberately not part of the key. A directive
 * moves down the file as the patch grows around it, and a claim that changed
 * identity every time an unrelated line was added above it would be a claim the
 * hook stopped for again on the next turn — the bug this exists to fix.
 */
export function patchClaims(report: Report): Claim[] {
  return [
    ...report.suppressions_new.map((s) => ({
      rule: s.rule,
      key: fingerprint(['ignore', s.rule, s.file, s.target ?? '', s.reason]),
    })),
    ...report.allowed.map((a) => ({
      rule: a.rule,
      key: fingerprint(['allow', a.rule, a.target ?? '', a.reason]),
    })),
  ];
}

function fingerprint(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** Malformed lines are skipped: a partial record still answers for the rest. */
export function readAnnounced(path: string, scope: ClaimScope): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // Nothing has been announced yet, or the file cannot be read. Either way
    // the hook stops once more, which is the safe direction to be wrong in.
    return new Set();
  }

  const keys = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<Announcement>;
      if (parsed.repo === scope.repo && parsed.branch === scope.branch && parsed.key)
        keys.add(parsed.key);
    } catch {
      // A truncated final line is the normal shape of a file being appended to
      // while it is read. One unreadable row is not worth losing the rest.
    }
  }
  return keys;
}

/** False when nothing could be written, so the caller can say the stop repeats. */
export function recordAnnounced(
  claimed: readonly Claim[],
  scope: ClaimScope,
  path: string,
  now: Date = new Date(),
): boolean {
  if (claimed.length === 0) return true;
  const lines = claimed
    .map((c) => JSON.stringify({ ts: now.toISOString(), ...scope, rule: c.rule, key: c.key }))
    .join('\n');

  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${lines}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function suppressionMemory(options: {
  scope: ClaimScope;
  env: NodeJS.ProcessEnv;
  warn: (message: string) => void;
}): SuppressionMemory {
  const path = announcedPath(options.env);
  return {
    seen: readAnnounced(path, options.scope),
    remember: (claimed) => {
      if (!recordAnnounced(claimed, options.scope, path))
        options.warn(
          'overlock: this notice could not be recorded, so it will stop the next turn too.\n',
        );
    },
  };
}
