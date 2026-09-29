import { describe, expect, it } from 'vitest';
import { canonicalQuotes, withoutStringContents } from './shared.js';

/** The pattern the scanner replaced, kept as the specification it has to meet. */
const byRegex = (text: string): string => text.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '$1$1');

const ALPHABET = ['"', "'", '`', '\\', 'a', ' ', '\n'];

/** Every string over the alphabet up to `max` characters long. */
function* everyString(max: number): Generator<string> {
  let layer = [''];
  yield '';
  for (let length = 1; length <= max; length += 1) {
    layer = layer.flatMap((prefix) => ALPHABET.map((c) => prefix + c));
    yield* layer;
  }
}

/** Longer strings, from a fixed seed so a failure reproduces. */
function* randomStrings(count: number): Generator<string> {
  const alphabet = [...ALPHABET, '\r', ' ', 'b'];
  let seed = 1;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return Math.floor(seed / 65536);
  };
  for (let n = 0; n < count; n += 1) {
    let text = '';
    const length = 8 + (next() % 40);
    for (let i = 0; i < length; i += 1) text += alphabet[next() % alphabet.length];
    yield text;
  }
}

const mismatches = (texts: Iterable<string>): string[] =>
  [...texts].filter((text) => withoutStringContents(text) !== byRegex(text));

describe('withoutStringContents', () => {
  it.each([
    ["it.skip('rejects')", "it.skip('')"],
    ['a "b" `c` d', 'a "" `` d'],
    ["'it\\'s' + x", "'' + x"],
    ['"unclosed', '"unclosed'],
    ['"a\\\nb" "c"', '"a\\\nb""c"'],
  ])('blanks %j', (text, expected) => {
    expect(withoutStringContents(text)).toBe(expected);
  });

  it('agrees with the regex on every short string', () => {
    expect(mismatches(everyString(6))).toEqual([]);
  });

  it('agrees with the regex on longer strings', () => {
    expect(mismatches(randomStrings(5000))).toEqual([]);
  });

  it('reads a literal of escaped quotes that never closes in linear time', () => {
    const text = `"${'\\"'.repeat(100_000)}`;
    expect(withoutStringContents(text)).toBe(text);
  });
});

describe('canonicalQuotes', () => {
  it('writes a single- and a double-quoted literal the same way', () => {
    expect(canonicalQuotes(`expect(x).toBe('high');`)).toBe(
      canonicalQuotes(`expect(x).toBe("high");`),
    );
  });

  it('treats an escaped quote and a bare one as the same character', () => {
    expect(canonicalQuotes(`t('it\\'s')`)).toBe(canonicalQuotes(`t("it's")`));
    expect(canonicalQuotes(`t('say "hi"')`)).toBe(canonicalQuotes(`t("say \\"hi\\"")`));
  });

  it('keeps literals that hold different characters apart', () => {
    expect(canonicalQuotes(`toBe('a')`)).not.toBe(canonicalQuotes(`toBe("b")`));
    expect(canonicalQuotes(`toBe('a\\\\')`)).not.toBe(canonicalQuotes(`toBe("a")`));
    expect(canonicalQuotes(`toBe('\\n')`)).not.toBe(canonicalQuotes(`toBe("n")`));
  });

  it('leaves template literals and text outside literals alone', () => {
    expect(canonicalQuotes('toBe(`high`)')).toBe('toBe(`high`)');
    expect(canonicalQuotes('toBe(42)')).toBe('toBe(42)');
  });

  it('stops rewriting at a literal that never closes', () => {
    expect(canonicalQuotes(`a('x') + 'open`)).toBe(`a("x") + 'open`);
  });
});
