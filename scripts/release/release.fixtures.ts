import type { Registry, Releases, Repo, Run } from "./release.types.ts";

/** An in-memory clone: `tags` maps a tag to the commit it names. */
export function fakeRepo(tags: Record<string, string>, files: Record<string, string> = {}) {
  const pushed: string[] = [];
  const repo: Repo = {
    fetchTags: () => undefined,
    commitOf: (ref) => tags[ref] ?? null,
    tag: (name, sha, { force = false } = {}) => {
      if (!force && name in tags) throw new Error(`tag ${name} exists`);
      tags[name] = sha;
      pushed.push(force ? `${name} (moved)` : name);
    },
    show: (sha, path) => files[`${sha}:${path}`] ?? "",
  };
  return { repo, tags, pushed };
}

export function fakeReleases(existing: string[] = []) {
  const created: { tag: string; sha: string; notes: string }[] = [];
  const releases: Releases = {
    exists: (tag) => existing.includes(tag),
    create: (release) => void created.push(release),
  };
  return { releases, created };
}

export const servingRegistry = (served: boolean): Registry => ({ serves: () => served });

/** A `Run` that records every call and answers from `reply`, which may throw. */
export function recordingRun(
  reply: (command: string, args: readonly string[]) => string = () => "",
) {
  const calls: { command: string; args: readonly string[]; input: string | undefined }[] = [];
  const run: Run = (command, args, input) => {
    calls.push({ command, args, input });
    return reply(command, args);
  };
  return { run, calls };
}
