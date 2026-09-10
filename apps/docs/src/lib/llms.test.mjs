import { describe, expect, it } from 'vitest';

import { groupPages, llmsFull, llmsIndex } from './llms.mjs';

const page = (id, overrides = {}) => ({
  id,
  section: id.includes('/') ? id.split('/')[0] : 'root',
  title: id,
  description: `About ${id}.`,
  mdUrl: `https://rxova.org/${id}.md`,
  htmlUrl: `https://rxova.org/${id}/`,
  body: `Body of ${id}.`,
  ...overrides,
});

const pages = [
  page('index', { section: 'root', title: 'overlock' }),
  page('reference/cli'),
  page('rules/test-removed'),
  page('learn/severity'),
];

describe('groupPages', () => {
  it('orders sections editorially, not alphabetically', () => {
    // The sidebar order is a judgement about what to read first. An agent has no
    // reason to get a worse one than a human.
    expect(groupPages(pages).map((g) => g.heading)).toEqual([
      'About',
      'Learn',
      'Rules',
      'Reference',
    ]);
  });

  it('gives an unknown directory a heading named after itself', () => {
    // Unlabelled beats missing: a new directory shows up in the index without
    // anyone having to edit SECTIONS first.
    const groups = groupPages([...pages, page('recipes/monorepo')]);

    expect(groups.at(-1)).toMatchObject({ heading: 'recipes' });
    expect(groups.at(-1).pages).toHaveLength(1);
  });

  it('drops no page', () => {
    const extra = [...pages, page('recipes/monorepo'), page('under-the-hood/scope')];

    expect(groupPages(extra).flatMap((g) => g.pages)).toHaveLength(extra.length);
  });
});

describe('llmsIndex', () => {
  const index = llmsIndex(pages, 'https://rxova.org');

  it('leads with the H1 and the summary blockquote llmstxt.org expects', () => {
    const lines = index.split('\n');

    expect(lines[0]).toBe('# overlock');
    expect(lines[2].startsWith('> ')).toBe(true);
  });

  it('states the two constraints that change how an agent writes the calling code', () => {
    expect(index).toContain('frozen');
    expect(index).toContain('reason');
  });

  it('points at llms-full.txt absolutely', () => {
    // This document is read detached from the site as often as it is fetched
    // from it, and a pasted copy has nothing to resolve a relative path against.
    expect(index).toContain('https://rxova.org/llms-full.txt');
  });

  it('links the .md twins, not the HTML pages', () => {
    expect(index).toContain('- [reference/cli](https://rxova.org/reference/cli.md): About');
    expect(index).not.toMatch(/\]\(https:\/\/rxova\.org\/reference\/cli\/\)/);
  });

  it('omits the colon for a page with no description', () => {
    const bare = llmsIndex([page('index', { description: undefined })], 'https://rxova.org');

    expect(bare).toContain('- [index](https://rxova.org/index.md)\n');
  });

  it('tells an agent what to do instead of silencing a finding', () => {
    expect(index).toContain('overlock-ignore');
    expect(index).toContain('Exit codes');
  });
});

describe('llmsFull', () => {
  const full = llmsFull(pages);

  it('inlines every body in the index order', () => {
    const order = ['index', 'learn/severity', 'rules/test-removed', 'reference/cli'].map((id) =>
      full.indexOf(`Body of ${id}.`),
    );

    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('states each page canonical HTML URL, so a reader can cite the page', () => {
    expect(full).toContain('Source: https://rxova.org/reference/cli/');
  });

  it('repeats the same summary the index carries', () => {
    expect(full.split('\n')[0]).toBe('# overlock');
    expect(full).toContain('> A deterministic CLI');
  });
});
