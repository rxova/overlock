import { describe, expect, it } from 'vitest';

import {
  absolutizeUrls,
  mapUnfenced,
  mdxToMarkdown,
  normalizePath,
  resolveRelativeLinks,
  splitFenced,
  stripImports,
  unwrapStarlightComponents,
} from './mdx-to-markdown.mjs';

const at = { origin: 'https://rxova.org', base: '/packages/overlock/' };

describe('mapUnfenced', () => {
  it('leaves fenced content alone', () => {
    // Half these pages are diffs, and a diff line starts with `-`. A rule applied
    // across the whole document rewrites the example it exists to preserve.
    const text = ['before', '```diff', '- expect(total).toBe(42);', '```', 'after'].join('\n');

    expect(mapUnfenced(text, (chunk) => chunk.toUpperCase())).toBe(
      ['BEFORE', '```diff', '- expect(total).toBe(42);', '```', 'AFTER'].join('\n'),
    );
  });

  it('does not close a fence on a longer fence-like line inside it', () => {
    // A fence closes on the same character, at least as long, with no info
    // string. `````js` inside a ```` block is content.
    const text = ['````md', '```js', 'const x = 1;', '```', '````', 'tail'].join('\n');

    expect(mapUnfenced(text, () => 'TOUCHED')).toBe(
      ['````md', '```js', 'const x = 1;', '```', '````', 'TOUCHED'].join('\n'),
    );
  });

  it('treats an unterminated fence as fenced to the end of the file', () => {
    // The safe direction: a missing close means the tail is left verbatim rather
    // than a runaway rule chewing through the rest of the page.
    expect(mapUnfenced('```sh\nnpx overlock\nstill code', () => 'TOUCHED')).toBe(
      '```sh\nnpx overlock\nstill code',
    );
  });
});

describe('splitFenced', () => {
  it('hands back the unfenced text and every opening fence', () => {
    const { unfenced, openers } = splitFenced(
      ['prose', '```json', '{"schema": 1}', '```', 'more'].join('\n'),
    );

    expect(unfenced).toBe('prose\nmore');
    expect(openers).toEqual(['```json']);
  });
});

describe('stripImports', () => {
  it('removes an import line', () => {
    expect(stripImports("import { Tabs } from '@astrojs/starlight/components';\n\nText.")).toBe(
      '\nText.',
    );
  });

  it('leaves prose that merely starts with the word import', () => {
    expect(stripImports('imports are stripped only at the start of a line.')).toBe(
      'imports are stripped only at the start of a line.',
    );
  });
});

describe('unwrapStarlightComponents', () => {
  it('keeps a TabItem label as a heading', () => {
    // Without this, the install snippets arrive as three unlabelled fences and
    // the reader cannot tell npm from pnpm — the one thing the block says.
    const text = ['<Tabs>', '<TabItem label="pnpm">', 'body', '</TabItem>', '</Tabs>'].join('\n');

    expect(unwrapStarlightComponents(text)).toContain('#### pnpm');
    expect(unwrapStarlightComponents(text)).not.toContain('<Tabs>');
  });
});

describe('normalizePath', () => {
  it.each([
    ['/learn/../rules/test-removed.md', '/rules/test-removed.md'],
    ['/rules/./overview.md', '/rules/overview.md'],
    // Clamped rather than escaping the root: a link that needed the clamp is
    // wrong at the source, and the checker reports it as a dangling twin.
    ['/../../etc/passwd', '/etc/passwd'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('resolveRelativeLinks', () => {
  it('resolves a sibling link against the page being written', () => {
    expect(
      resolveRelativeLinks('See [severity](./severity.md).', {
        ...at,
        fromRoute: '/learn/false-positives.md',
      }),
    ).toBe('See [severity](https://rxova.org/packages/overlock/learn/severity.md).');
  });

  it('carries the fragment through', () => {
    expect(
      resolveRelativeLinks('[the table](../rules/overview.md#the-eleven)', {
        ...at,
        fromRoute: '/learn/severity.md',
      }),
    ).toBe('[the table](https://rxova.org/packages/overlock/rules/overview.md#the-eleven)');
  });

  it('leaves a link to a non-markdown target alone', () => {
    const text = '[the logo](../assets/logo.svg)';

    expect(resolveRelativeLinks(text, { ...at, fromRoute: '/index.md' })).toBe(text);
  });
});

describe('absolutizeUrls', () => {
  it('absolutizes a root-relative link through the mount base', () => {
    expect(absolutizeUrls('[cli](/reference/cli/)', at)).toBe(
      '[cli](https://rxova.org/packages/overlock/reference/cli/)',
    );
  });

  it('leaves a protocol-relative URL alone', () => {
    expect(absolutizeUrls('[x](//cdn.example.com/a.png)', at)).toBe('[x](//cdn.example.com/a.png)');
  });

  it('resolves a BASE_URL expression attribute', () => {
    expect(absolutizeUrls('<img src={`${import.meta.env.BASE_URL}favicon.svg`} />', at)).toContain(
      'src="https://rxova.org/packages/overlock/favicon.svg"',
    );
  });
});

describe('mdxToMarkdown', () => {
  it('runs the pipeline without touching a fence', () => {
    const source = [
      "import { Tabs } from '@astrojs/starlight/components';",
      '',
      'Read [the rules](../rules/overview.md).',
      '',
      '```sh',
      '# ](/not-a-link) and an import line, both verbatim',
      "import { Tabs } from '@astrojs/starlight/components';",
      '```',
    ].join('\n');

    const out = mdxToMarkdown(source, { ...at, fromRoute: '/learn/severity.md' });

    expect(out).toContain('[the rules](https://rxova.org/packages/overlock/rules/overview.md)');
    expect(out).toContain('# ](/not-a-link) and an import line, both verbatim');
    expect(out.match(/import \{ Tabs \}/g)).toHaveLength(1);
  });

  it('resolves relative links before root-relative ones', () => {
    // Reversing the order leaves `../rules/x.md` as the one link shape in the
    // document that nothing handles.
    const out = mdxToMarkdown('[a](../rules/overview.md) [b](/reference/cli/)', {
      ...at,
      fromRoute: '/learn/severity.md',
    });

    expect(out).toBe(
      '[a](https://rxova.org/packages/overlock/rules/overview.md) ' +
        '[b](https://rxova.org/packages/overlock/reference/cli/)',
    );
  });

  it('collapses the blank lines unwrapping leaves behind', () => {
    expect(mdxToMarkdown("import X from 'x';\n\n\n\nBody.", { ...at })).toBe('Body.');
  });
});
