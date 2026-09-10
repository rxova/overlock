import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FORBIDDEN, checkMdRoutes, isUntwinned, twinFor } from './check-md-routes.mjs';

/** Write a throwaway dist tree: `{ 'a/index.html': '…' }`. */
async function dist(files) {
  const dir = await mkdtemp(join(tmpdir(), 'overlock-docs-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

const PREFIX = 'https://rxova.org/packages/overlock';

/** A twin whose `source:` frontmatter pins the site prefix the checker reads back. */
const twin = (route, body = 'Body.') =>
  ['---', `title: "${route}"`, `source: ${PREFIX}/${route}/`, '---', '', body, ''].join('\n');

const page = (title = 'Page') => `<!doctype html><title>${title}</title><p>Hi.</p>`;

describe('twinFor', () => {
  it.each([
    ['index.html', 'index.md'],
    ['rules/test-removed/index.html', 'rules/test-removed.md'],
  ])('%s -> %s', (html, md) => {
    expect(twinFor(html)).toBe(md);
  });
});

describe('isUntwinned', () => {
  it('excludes only Astro 404', () => {
    expect(isUntwinned('404.html')).toBe(true);
    expect(isUntwinned('rules/test-removed/index.html')).toBe(false);
  });
});

describe('FORBIDDEN', () => {
  it('is made of real patterns, none of which match an empty string', () => {
    // A regex that matches everything reports every twin; one that matches
    // nothing silently stops checking. Both look like a passing build.
    for (const [pattern, why] of FORBIDDEN) {
      expect(pattern, why).toBeInstanceOf(RegExp);
      expect(pattern.test(''), why).toBe(false);
    }
  });
});

describe('checkMdRoutes', () => {
  it('passes a well-formed build', async () => {
    const dir = await dist({
      'index.html': page(),
      'index.md': twin('index'),
      'rules/test-removed/index.html': page(),
      'rules/test-removed.md': twin('rules/test-removed'),
      '404.html': page('404'),
    });

    const { failures, twins } = await checkMdRoutes(dir);

    expect(failures).toEqual([]);
    expect(twins).toBe(2);
  });

  it('reports a page with no twin', async () => {
    const dir = await dist({
      'index.md': twin('index'),
      'rules/test-removed/index.html': page(),
      'reference/cli.md': twin('reference/cli'),
      'reference/cli/index.html': page(),
    });

    const { failures } = await checkMdRoutes(dir);

    expect(failures).toEqual([
      'rules/test-removed/index.html has no markdown twin at rules/test-removed.md',
    ]);
  });

  it('skips a redirect stub, which has no content to twin', async () => {
    const dir = await dist({
      'old/index.html': '<meta http-equiv="refresh" content="0;url=/new/">',
      'reference/cli/index.html': page(),
      'reference/cli.md': twin('reference/cli'),
    });

    expect((await checkMdRoutes(dir)).failures).toEqual([]);
  });

  it('reports unhandled markup, and only outside a fence', async () => {
    const dir = await dist({
      'reference/cli.md': twin('reference/cli', '<TabItem label="npm">'),
      'reference/suppressions.md': twin(
        'reference/suppressions',
        ['```md', '<TabItem label="npm">', 'see [x](/reference/cli/)', '```'].join('\n'),
      ),
    });

    const { failures } = await checkMdRoutes(dir);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('reference/cli.md');
    expect(failures[0]).toContain('an unhandled Starlight/MDX component');
  });

  it('reports a link to a twin that does not exist', async () => {
    // The one a build cannot notice: `./severity.md` from a page that is not in
    // `learn/` is a well-formed link nothing else reads.
    const dir = await dist({
      'learn/severity.md': twin('learn/severity', `[cli](${PREFIX}/reference/cli.md)`),
    });

    expect((await checkMdRoutes(dir)).failures).toEqual([
      'learn/severity.md links to reference/cli.md, which is not a twin',
    ]);
  });

  it('accepts a link to a twin that does exist', async () => {
    const dir = await dist({
      'learn/severity.md': twin('learn/severity', `[cli](${PREFIX}/reference/cli.md#exit-codes)`),
      'reference/cli.md': twin('reference/cli'),
    });

    expect((await checkMdRoutes(dir)).failures).toEqual([]);
  });

  it('reports twins it cannot pin a site prefix from', async () => {
    // Without the prefix the link check silently stops running, which is the
    // failure this whole script exists to avoid.
    const dir = await dist({ 'reference/cli.md': '# No frontmatter here.\n' });

    expect((await checkMdRoutes(dir)).failures).toEqual([
      'could not determine the site prefix from any twin\'s "source:" frontmatter',
    ]);
  });

  it('reports llms-full.txt over budget', async () => {
    const dir = await dist({
      'reference/cli.md': twin('reference/cli'),
      'llms-full.txt': 'x'.repeat(801 * 1024),
    });

    const { failures } = await checkMdRoutes(dir);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('llms-full.txt is 801 kB');
  });

  it('says nothing about budgets when the endpoints are absent', async () => {
    // Keeps the script usable against a build that predates them.
    const dir = await dist({ 'reference/cli.md': twin('reference/cli') });

    expect((await checkMdRoutes(dir)).failures).toEqual([]);
  });
});
