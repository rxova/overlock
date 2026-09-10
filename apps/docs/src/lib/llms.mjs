// The llms.txt pair: https://llmstxt.org
//
// `llms.txt` is an index — headings and links, small enough that fetching it
// costs nothing and an agent can decide what else to read. `llms-full.txt` is
// every page inlined, for the case where one fetch should be the whole thing.
//
// Both are built from `docsPages()`, the same enumeration the `.md` twins use,
// so the three surfaces cannot disagree about what pages exist. Everything here
// is pure — the endpoints in src/pages are three-line adapters — because the
// shape of these documents is the part worth testing, and checking it needs no
// Astro.
//
// There is a second reason to take this file seriously here. overlock's whole
// job is to be read by an agent that is about to edit a test suite, and the
// summary below is the paragraph that agent sees first. If it is vague, the
// agent guesses; if it is precise, the agent knows before its first tool call
// that the eleven rule IDs are frozen and that a suppression needs a reason.

/**
 * The tool's own summary, as the blockquote llmstxt.org puts under the H1.
 *
 * Written here rather than lifted from a page's frontmatter: `index.md` opens
 * with a sentence aimed at a human who has just arrived. This is the paragraph a
 * model needs first — what the tool does, what it will not do, and the two
 * constraints that change how it writes the calling code.
 */
const SUMMARY = [
  'A deterministic CLI that reads a git patch and reports the edits that make a',
  'test suite ask less than it did: skipped tests, removed or loosened',
  'assertions, lowered coverage thresholds, narrowed test data. Eleven rules,',
  'graded high/medium/low; only high fails a run by default. No model calls, no',
  'network calls, no telemetry, zero runtime dependencies, and it never writes to',
  'your code or to the git index. A finding is a statement about the diff and',
  'nothing more: overlock does not run your tests, judge your implementation, or',
  'infer intent. Rule IDs are frozen — adding one is a minor release, changing',
  'what one means is a breaking one. Findings can be silenced, but only by name',
  'and only with a written reason, and every suppression is counted in the report.',
];

/**
 * Directory name -> heading, in reading order.
 *
 * Mirrors the sidebar in astro.config.mjs, because that order is a real
 * editorial judgement about what to read first and there is no reason for an
 * agent to get a worse one than a human. A directory missing from this map still
 * gets a heading — see `groupPages` — so adding one is not a silent omission,
 * just an unlabelled section.
 */
const SECTIONS = [
  ['root', 'About'],
  ['learn', 'Learn'],
  ['rules', 'Rules'],
  ['integrations', 'Integrations'],
  ['reference', 'Reference'],
  ['under-the-hood', 'Under the hood'],
];

/**
 * One entry. The description is what makes the index worth fetching: a bare list
 * of thirty links tells an agent nothing about which one answers its question.
 */
const link = (page, note) => `- [${page.title}](${page.mdUrl})${note ? `: ${note}` : ''}`;

/** Group pages by section, in the order a reader should meet them. */
export function groupPages(pages) {
  const bySection = new Map();
  for (const page of pages) {
    if (!bySection.has(page.section)) bySection.set(page.section, []);
    bySection.get(page.section).push(page);
  }

  const groups = [];
  const take = (key, heading) => {
    const found = bySection.get(key);
    if (found?.length) groups.push({ heading, pages: found });
    bySection.delete(key);
  };

  for (const [key, heading] of SECTIONS) take(key, heading);

  // A directory the map does not know, named after itself: an unlabelled section
  // beats a missing one.
  for (const key of [...bySection.keys()].sort()) take(key, key);

  return groups;
}

/**
 * The index.
 *
 * Links point at the `.md` twins rather than the HTML pages. An agent following
 * a link from here wants the content, not the chrome — and sending it to HTML
 * when a markdown twin exists wastes the fetch this file exists to save.
 */
export function llmsIndex(pages, origin) {
  const lines = [
    '# overlock',
    '',
    ...SUMMARY.map((l) => `> ${l}`),
    '',
    'Every link below is raw markdown. The human page is the same URL without the',
    '`.md` suffix.',
    '',
    // Absolute, not "the file beside this one". This document is read detached
    // from the site as often as it is fetched from it, and a reader that has it
    // pasted into a prompt has nothing to resolve a relative reference against.
    `Everything inlined in one fetch: ${origin}/llms-full.txt`,
    '',
    '## Run it',
    '',
    '    npx overlock                 # the current patch',
    '    npx overlock --json          # the full report, schema 1',
    '    npx overlock init claude     # write the Stop hook into .claude/settings.json',
    '',
    'Exit codes: 0 nothing at or above --fail-on, 1 findings at or above it, 2',
    'overlock could not run. Requires Node.js 20.11 or newer. The package has zero',
    'runtime dependencies, so a cold `npx` is one small download.',
    '',
    '## If you are an agent reading this before editing tests',
    '',
    'The finding you are most likely to cause is `TEST_SKIPPED_ADDED` or',
    '`ASSERTION_WEAKENED`, and the fix for both is the same: make the test pass, or',
    'delete it deliberately and say why. Do not silence a finding to get a green',
    'run. If a suppression really is right, it needs the rule ID and a written',
    'reason — `// overlock-ignore TEST_SKIPPED_ADDED -- quarantined pending #412` —',
    'and the Stop hook will stop once anyway to quote the claim back at a human.',
    'A directive with no reason, or with a rule ID that does not exist, silences',
    'nothing at all.',
    '',
  ];

  for (const { heading, pages: group } of groupPages(pages)) {
    lines.push(`## ${heading}`, '');
    for (const page of group) lines.push(link(page, page.description));
    lines.push('');
  }

  return lines.join('\n');
}

/** Everything inlined, in the same order the index lists it. */
export function llmsFull(pages) {
  const ordered = groupPages(pages).flatMap((g) => g.pages);
  const head = ['# overlock', '', ...SUMMARY.map((l) => `> ${l}`), ''].join('\n');

  return [
    head,
    ...ordered.map((page) =>
      ['---', '', `# ${page.title}`, '', `Source: ${page.htmlUrl}`, '', page.body, ''].join('\n'),
    ),
  ].join('\n');
}
