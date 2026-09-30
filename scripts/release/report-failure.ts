/** Prints each line of a failure as a GitHub Actions error annotation. */
export function reportFailure(failure: unknown): void {
  const message = failure instanceof Error ? failure.message : String(failure);
  for (const line of message.split("\n")) console.log(`::error::${line}`);
}
