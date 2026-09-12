import type { DiffFile, DiffLine, Hunk } from './types.js';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses `git diff --no-color` output.
 *
 * Hand-written rather than a dependency, because the whole premise of the tool
 * is that `npx overlock` is one small download an agent can afford to run on
 * every turn. A diff parser is roughly a hundred lines; a dependency is a
 * round trip on every invocation plus a supply-chain surface on a tool whose
 * entire job is trust.
 */
export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = raw.split('\n');

  let current: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const closeFile = (): void => {
    if (current) files.push(current);
    current = null;
    hunk = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (line.startsWith('diff --git ')) {
      closeFile();
      const paths = parseDiffGitHeader(line);
      current = {
        path: paths.b,
        oldPath: null,
        status: 'modified',
        hunks: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = line.slice('rename from '.length);
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.status = 'renamed';
      current.path = line.slice('rename to '.length);
      continue;
    }
    // `Binary files a/x and b/y differ` — nothing here can read it, and a rule
    // that guessed at one would be guessing.
    if (line.startsWith('Binary files ')) {
      hunk = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4);
      if (p !== '/dev/null' && current.oldPath === null) current.oldPath = cleanPath(p);
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      // A deletion's post-image is /dev/null, so the pre-image path is the only
      // name the file has. Everything downstream reports on `path`.
      if (p === '/dev/null') {
        if (current.oldPath) current.path = current.oldPath;
      } else {
        current.path = cleanPath(p);
      }
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      hunk = { oldStart: oldLine, newStart: newLine, lines: [] };
      current.hunks.push(hunk);
      continue;
    }

    if (!hunk) continue;

    // `\ No newline at end of file` annotates the preceding line rather than
    // being one.
    if (line.startsWith('\\')) continue;

    const marker = line[0];
    const text = line.slice(1);
    let entry: DiffLine | null = null;

    if (marker === '+') {
      entry = { kind: 'add', text, oldLine: null, newLine };
      newLine += 1;
    } else if (marker === '-') {
      entry = { kind: 'del', text, oldLine, newLine: null };
      oldLine += 1;
    } else if (marker === ' ') {
      entry = { kind: 'ctx', text, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
    }

    if (entry) hunk.lines.push(entry);
  }

  closeFile();
  return files;
}

/**
 * `diff --git a/x b/y` with no quoting is unambiguous only when neither path
 * contains a space, which is why git quotes paths that do. Handle the quoted
 * form first, then fall back to splitting the unquoted pair at its midpoint —
 * the two halves are the same path when it is not a rename, and git emits the
 * `rename from`/`rename to` lines when it is, so a bad split here is corrected
 * a few lines later.
 */
function parseDiffGitHeader(line: string): { a: string; b: string } {
  const rest = line.slice('diff --git '.length);

  // git escapes a quote inside a quoted path, so each path is a run of
  // non-quotes and escapes. `(.+)" "(.+)` also split on an escaped `\" "`, and
  // tried every such split, which is quadratic.
  const quoted = /^"((?:[^"\\]|\\.)+)" "((?:[^"\\]|\\.)+)"$/.exec(rest);
  if (quoted) {
    return { a: cleanPath(quoted[1] ?? ''), b: cleanPath(quoted[2] ?? '') };
  }

  const halves = rest.split(' ');
  if (halves.length === 2) {
    return { a: cleanPath(halves[0] ?? ''), b: cleanPath(halves[1] ?? '') };
  }

  const mid = Math.floor(halves.length / 2);
  return {
    a: cleanPath(halves.slice(0, mid).join(' ')),
    b: cleanPath(halves.slice(mid).join(' ')),
  };
}

/**
 * git wraps a path containing spaces or non-ASCII bytes in double quotes and
 * backslash-escapes the contents. Every path in the diff — the `diff --git`
 * pair and both `---`/`+++` lines — can arrive in that form, so unquoting has
 * to happen before the a/ b/ prefix is stripped, not after: `"b/my file.ts"`
 * does not start with `b/`.
 */
function cleanPath(raw: string): string {
  let path = raw;
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = path.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2);
  return path;
}

/** Every added line in a file, flattened, with its post-image line number. */
export function addedLines(file: DiffFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'add'));
}

/** Every removed line in a file, flattened, with its pre-image line number. */
export function removedLines(file: DiffFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'del'));
}

/**
 * A hunk's changed lines, split into the runs they were written as.
 *
 * A hunk is a region of the file, not an edit: `git diff` merges edits three
 * context lines apart into one, so a hunk over a test file routinely spans two
 * or three unrelated cases. A rule that pairs a removal with an addition across
 * a whole hunk therefore pairs across test cases, and reports an assertion
 * deleted in one case as the weakening of an assertion added in another.
 *
 * Context ends a run, because a line neither side touched is the boundary
 * between two edits by definition.
 */
export function changeBlocks(hunk: Hunk): DiffLine[][] {
  const blocks: DiffLine[][] = [];
  let current: DiffLine[] = [];

  for (const line of hunk.lines) {
    if (line.kind === 'ctx') {
      if (current.length > 0) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  return blocks;
}
