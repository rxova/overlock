/**
 * One repository, one answer.
 *
 * The CLI, the GitHub action and the Stop hook each used to arrive at their own
 * base, their own fail-on and their own severity grades, which meant the same
 * patch could pass locally and block in CI with nothing to point at. Anyone
 * wanting them to agree had to carry the policy between them by hand, in a
 * wrapper script — and a wrapper script is where the drift lives, not where it
 * is fixed.
 *
 * So the policy is declared once, in the repository, and every surface reads it.
 * A flag still wins over the file: the file is the default, not a cage.
 *
 * Unknown keys and wrong types are errors, never warnings. A `failon` typo that
 * silently did nothing would leave someone certain a rule was graded down and
 * finding out otherwise from a blocked merge — the same failure this file is
 * meant to prevent.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { BaseMode } from './git.js';
import type { EvaluationConfig } from './evaluation-record.js';
import { RULE_IDS, type Grade, type RuleId, type Severity } from './types.js';

export class ConfigError extends Error {}

export interface OverlockConfig {
  base?: string;
  baseMode?: BaseMode;
  failOn?: Severity | 'none';
  failOnEmpty?: boolean;
  severity?: Partial<Record<RuleId, Grade>>;
  testGlob?: string[];
  untracked?: boolean;
  evaluation?: EvaluationConfig;
}

export interface LoadedConfig {
  config: OverlockConfig;
  /** Where it came from, for the message that says which file was obeyed. */
  path: string | null;
}

/** The file looked for, in the order it is looked for. */
export const CONFIG_FILE = 'overlock.config.json';
/** The key read from a package.json when there is no config file beside it. */
export const CONFIG_KEY = 'overlock';

const KEYS = [
  'base',
  'baseMode',
  'failOn',
  'failOnEmpty',
  'severity',
  'testGlob',
  'untracked',
  'evaluation',
];
const LEVELS = ['high', 'medium', 'low'];
/**
 * What a rule may be graded, which is one more than a finding may carry.
 *
 * `off` belongs here and not in `failOn`: turning a rule off is a judgement
 * about that rule, while a `failOn` of `none` is a judgement about all of them,
 * and the second already exists.
 */
const GRADES = [...LEVELS, 'off'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates a parsed object into a config, naming the file in every message.
 *
 * Exported so that a caller holding the object already — a test, or a future
 * surface that reads its settings from somewhere other than a file — validates
 * it on exactly the same terms.
 */
export function parseConfig(value: unknown, where: string): OverlockConfig {
  if (!isObject(value)) throw new ConfigError(`${where}: expected an object`);

  for (const key of Object.keys(value)) {
    if (!KEYS.includes(key)) {
      throw new ConfigError(
        `${where}: unknown setting ${JSON.stringify(key)}. Known: ${KEYS.join(', ')}`,
      );
    }
  }

  const config: OverlockConfig = {};
  if (value.evaluation !== undefined) {
    const entry = value.evaluation;
    if (
      !isObject(entry) ||
      Object.keys(entry).some((k) => k !== 'repository' && k !== 'captureDiff') ||
      (entry.captureDiff !== undefined && typeof entry.captureDiff !== 'boolean') ||
      typeof entry.repository !== 'string' ||
      !/^[\w.-]+(?:\/[\w.-]+)*$/.test(entry.repository)
    ) {
      throw new ConfigError(
        `${where}: evaluation must contain a stable repository name, e.g. {"repository":"team/project"}`,
      );
    }
    config.evaluation = { repository: entry.repository };
    if (typeof entry.captureDiff === 'boolean') config.evaluation.captureDiff = entry.captureDiff;
  }

  if (value.base !== undefined) {
    if (typeof value.base !== 'string' || value.base === '') {
      throw new ConfigError(`${where}: base must be a non-empty string`);
    }
    config.base = value.base;
  }

  if (value.baseMode !== undefined) {
    if (value.baseMode !== 'fork-point' && value.baseMode !== 'direct') {
      throw new ConfigError(`${where}: baseMode must be "fork-point" or "direct"`);
    }
    config.baseMode = value.baseMode;
  }

  if (value.failOn !== undefined) {
    if (typeof value.failOn !== 'string' || ![...LEVELS, 'none'].includes(value.failOn)) {
      throw new ConfigError(`${where}: failOn must be high, medium, low or none`);
    }
    config.failOn = value.failOn as Severity | 'none';
  }

  if (value.failOnEmpty !== undefined) {
    if (typeof value.failOnEmpty !== 'boolean') {
      throw new ConfigError(`${where}: failOnEmpty must be true or false`);
    }
    config.failOnEmpty = value.failOnEmpty;
  }

  if (value.untracked !== undefined) {
    if (typeof value.untracked !== 'boolean') {
      throw new ConfigError(`${where}: untracked must be true or false`);
    }
    config.untracked = value.untracked;
  }

  if (value.severity !== undefined) {
    if (!isObject(value.severity)) {
      throw new ConfigError(`${where}: severity must be an object of RULE_ID to level`);
    }
    const severity: Partial<Record<RuleId, Grade>> = {};
    for (const [rule, level] of Object.entries(value.severity)) {
      if (!(RULE_IDS as readonly string[]).includes(rule)) {
        throw new ConfigError(`${where}: severity names an unknown rule ${JSON.stringify(rule)}`);
      }
      if (typeof level !== 'string' || !GRADES.includes(level)) {
        throw new ConfigError(`${where}: severity.${rule} must be high, medium, low or off`);
      }
      severity[rule as RuleId] = level as Grade;
    }
    config.severity = severity;
  }

  if (value.testGlob !== undefined) {
    if (!Array.isArray(value.testGlob) || value.testGlob.some((p) => typeof p !== 'string')) {
      throw new ConfigError(`${where}: testGlob must be an array of regex strings`);
    }
    for (const pattern of value.testGlob as string[]) {
      try {
        new RegExp(pattern);
      } catch (error) {
        throw new ConfigError(`${where}: testGlob has an invalid regex: ${pattern}`, {
          cause: error,
        });
      }
    }
    config.testGlob = value.testGlob as string[];
  }

  return config;
}

const readJson = (file: string): unknown => {
  const text = readFileSync(file, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConfigError(`${file}: not valid JSON`, { cause: error });
  }
};

/**
 * The nearest declaration at or above `cwd`.
 *
 * Walked upwards rather than read from the repository root only, because a
 * monorepo package can have its own answer, and the surface running inside that
 * package should get it. A `package.json` without an `overlock` key is not a
 * declaration and does not stop the walk — otherwise every nested package would
 * silently shadow the root's policy.
 */
export function loadConfig(options: {
  cwd: string;
  /** An explicit file, which must exist and must parse. */
  path?: string | undefined;
}): LoadedConfig {
  if (options.path !== undefined) {
    const file = isAbsolute(options.path) ? options.path : resolve(options.cwd, options.path);
    let raw: unknown;
    try {
      raw = readJson(file);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(`${file}: cannot be read`, { cause: error });
    }
    return { config: parseConfig(raw, file), path: file };
  }

  let dir = resolve(options.cwd);
  for (;;) {
    const file = join(dir, CONFIG_FILE);
    try {
      const raw = readJson(file);
      return { config: parseConfig(raw, file), path: file };
    } catch (error) {
      // A malformed file that exists is a hard error; an absent one is not.
      if (error instanceof ConfigError) throw error;
    }

    const manifest = join(dir, 'package.json');
    try {
      const raw = readJson(manifest);
      if (isObject(raw) && raw[CONFIG_KEY] !== undefined) {
        return {
          config: parseConfig(raw[CONFIG_KEY], `${manifest} (${CONFIG_KEY})`),
          path: manifest,
        };
      }
    } catch (error) {
      if (error instanceof ConfigError) throw error;
    }

    const parent = dirname(dir);
    if (parent === dir) return { config: {}, path: null };
    dir = parent;
  }
}
