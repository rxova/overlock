import { execFileSync } from "node:child_process";
import type { Run } from "./release.types.ts";

/** Runs a command for real, inheriting stderr so a failure explains itself in the job log. */
export const runCommand: Run = (command, args, input) =>
  execFileSync(command, args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
