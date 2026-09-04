import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isEntry } from './entry.js';

describe('isEntry', () => {
  const url = pathToFileURL('/repo/packages/tooling/audit.ts').href;

  it('recognises the file Node was asked to run', () => {
    expect(isEntry(url, '/repo/packages/tooling/audit.ts')).toBe(true);
  });

  it('does not confuse a different file with the same basename', () => {
    expect(isEntry(url, '/elsewhere/audit.ts')).toBe(false);
  });

  it('is false when this module was merely imported', () => {
    expect(isEntry(url, '/repo/node_modules/vitest/dist/cli.js')).toBe(false);
  });

  it('survives an argv with no script in it', () => {
    expect(isEntry(url, undefined)).toBe(false);
    expect(isEntry(url, '')).toBe(false);
  });

  it('reads process.argv when it is not told otherwise', () => {
    expect(isEntry('file:///definitely/not/the/entry.ts')).toBe(false);
  });
});
