/**
 * overlock's version in changesets/action's `publishedPackages` output, or null
 * when this run published nothing, or published everything but overlock.
 */
export function publishedVersion(published: string): string | null {
  if (published.trim() === "") return null;
  const parsed: unknown = JSON.parse(published);
  if (!Array.isArray(parsed)) throw new Error(`publishedPackages is not a list: ${published}`);
  const entry = (parsed as { name?: unknown; version?: unknown }[]).find(
    (item) => item.name === "overlock",
  );
  return typeof entry?.version === "string" && entry.version !== "" ? entry.version : null;
}
