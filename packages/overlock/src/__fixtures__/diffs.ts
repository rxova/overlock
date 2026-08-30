/**
 * Diff text is the input format of every rule, so the fixtures are real
 * `git diff` output rather than hand-shaped objects: a parser bug and a rule
 * bug should not be able to cancel each other out.
 */

export function diffOf(
  path: string,
  hunk: string,
  options: { status?: 'added' | 'deleted' | 'modified'; oldPath?: string } = {},
): string {
  const { status = 'modified', oldPath } = options;
  const from = oldPath ?? path;

  const header = [`diff --git a/${from} b/${path}`];
  if (status === 'added') header.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`);
  else if (status === 'deleted')
    header.push('deleted file mode 100644', `--- a/${from}`, '+++ /dev/null');
  else if (oldPath)
    header.push(
      'similarity index 92%',
      `rename from ${from}`,
      `rename to ${path}`,
      `--- a/${from}`,
      `+++ b/${path}`,
    );
  else header.push(`--- a/${from}`, `+++ b/${path}`);

  return `${[...header, hunk].join('\n')}\n`;
}

/** A hunk header plus body, with sensible line numbers. */
export function hunk(body: string, oldStart = 1, newStart = 1): string {
  const lines = body.split('\n');
  const oldCount = lines.filter((l) => l.startsWith('-') || l.startsWith(' ')).length;
  const newCount = lines.filter((l) => l.startsWith('+') || l.startsWith(' ')).length;
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body}`;
}
