/**
 * Prefixes a site-root-relative URL with the site's `base`.
 *
 * Astro emits a root-relative URL verbatim, so under the rxova.org aggregator
 * (`DOCS_BASE_URL=/packages/overlock/`) a link written as `/rules/test-removed`
 * points one directory above where these docs are mounted. Everything that
 * writes a link into the agent-facing surfaces goes through here.
 *
 * Left alone: protocol-relative (`//host`) and absolute URLs, and anything that
 * already carries the base — so applying it twice is a no-op.
 */
export function withBase(url, base = '/') {
  const prefix = base.replace(/\/+$/, '');
  if (!prefix || typeof url !== 'string') return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  if (url === prefix || url.startsWith(`${prefix}/`)) return url;
  return prefix + url;
}
