/** Runs a command and returns its stdout; throws when it exits non-zero. */
export type Run = (command: string, args: readonly string[], input?: string) => string;

/** The git operations the release needs, over whatever clone the job checked out. */
export interface Repo {
  fetchTags: () => void;
  /** The commit a tag or ref names, or null when it does not exist. */
  commitOf: (ref: string) => string | null;
  /** Creates the tag and pushes it; `force` moves an existing one. */
  tag: (name: string, sha: string, options?: { force?: boolean }) => void;
  /** A file's contents at a commit. */
  show: (sha: string, path: string) => string;
}

export interface Releases {
  exists: (tag: string) => boolean;
  create: (release: { tag: string; sha: string; notes: string }) => void;
}

export interface Registry {
  serves: (name: string, version: string) => boolean;
}

export type Log = (message: string) => void;
