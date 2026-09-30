/**
 * The changelog entry changesets wrote for `version`: the lines under its
 * `## <version>` heading, up to the next one. It is the text written for a
 * reader, which a generated list of commit subjects is not.
 */
export function changelogNotes(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) return "See packages/overlock/CHANGELOG.md.\n";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const entry = end === -1 ? rest : rest.slice(0, end);
  return entry.length === 0 ? "See packages/overlock/CHANGELOG.md.\n" : `${entry.join("\n")}\n`;
}
