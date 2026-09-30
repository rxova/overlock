import { afterEach, describe, expect, it, vi } from "vitest";
import { reportFailure } from "./report-failure.ts";

describe("reportFailure", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  afterEach(() => log.mockClear());

  it("annotates every line of an error", () => {
    reportFailure(new Error("first\nsecond"));
    expect(log.mock.calls).toEqual([["::error::first"], ["::error::second"]]);
  });

  it("annotates a thrown value that is not an Error", () => {
    reportFailure("plain");
    expect(log.mock.calls).toEqual([["::error::plain"]]);
  });
});
