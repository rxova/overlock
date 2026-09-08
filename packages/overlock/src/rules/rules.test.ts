import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze.js';
import { diffOf, hunk } from '../__fixtures__/diffs.js';
import type { RuleId } from '../types.js';

/** Rules are exercised through `analyze`, which is how every caller reaches them. */
function rulesFor(diff: string): RuleId[] {
  return analyze({ diff }).findings.map((f) => f.rule);
}

function findingsOf(diff: string, rule: RuleId) {
  return analyze({ diff }).findings.filter((f) => f.rule === rule);
}

describe('TEST_REMOVED', () => {
  it('fires high when a test file is deleted', () => {
    const diff = diffOf('src/auth.test.ts', hunk("-it('rejects', () => {})"), {
      status: 'deleted',
    });
    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('deleted');
  });

  it('fires high when a test file is renamed out of the glob', () => {
    const diff = diffOf('src/auth.helpers.ts', hunk(' const x = 1;'), {
      oldPath: 'src/auth.test.ts',
    });
    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('renamed out');
  });

  it('stays quiet when a test file is renamed to another test path', () => {
    const diff = diffOf('src/auth.spec.ts', hunk(' const x = 1;'), { oldPath: 'src/auth.test.ts' });
    expect(rulesFor(diff)).not.toContain('TEST_REMOVED');
  });

  it('fires medium when a case disappears from a surviving file', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk([" it('keeps this', () => {})", "-  it('rejects expired tokens', () => {})"].join('\n')),
    );
    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('rejects expired tokens');
  });

  it('treats a moved case as surviving', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(["-  it('rejects', () => {})", "+  it('rejects', () => { /* moved */ })"].join('\n')),
    );
    expect(rulesFor(diff)).not.toContain('TEST_REMOVED');
  });

  it('grades down when every case reappears elsewhere in the patch', () => {
    const diff =
      diffOf(
        'src/auth.test.ts',
        hunk(["-it('rejects expired', () => {})", "-it('accepts fresh', () => {})"].join('\n')),
        { status: 'deleted' },
      ) +
      diffOf(
        'src/auth/tokens.test.ts',
        hunk(["+it('rejects expired', () => {})", "+it('accepts fresh', () => {})"].join('\n')),
        { status: 'added' },
      );

    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('all 2');
  });

  it('names the cases that did not reappear, and only those', () => {
    const diff =
      diffOf(
        'src/auth.test.ts',
        hunk(
          ["-it('rejects expired', () => {})", "-it('formats the amount', () => {})"].join('\n'),
        ),
        { status: 'deleted' },
      ) +
      diffOf('src/auth/tokens.test.ts', hunk("+it('rejects expired', () => {})"), {
        status: 'added',
      });

    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('1 of 2');
    expect(found?.message).toContain('formats the amount');
    expect(found?.message).not.toContain('rejects expired');
  });

  it('grades down when the module under test was deleted too', () => {
    const diff =
      diffOf('src/api.test.ts', hunk("-it('rejects', () => {})"), { status: 'deleted' }) +
      diffOf('src/api.ts', hunk('-export const api = 1;'), { status: 'deleted' });

    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('src/api.ts');
  });

  it('does not grade down when the module under test was merely modified', () => {
    const diff =
      diffOf('src/api.test.ts', hunk("-it('rejects', () => {})"), { status: 'deleted' }) +
      diffOf('src/api.ts', hunk('-const a = 1;\n+const a = 2;'));

    expect(findingsOf(diff, 'TEST_REMOVED')[0]?.severity).toBe('high');
  });

  it('points at the file rather than a line that no longer exists', () => {
    const diff = diffOf('src/auth.test.ts', hunk("-it('rejects', () => {})"), {
      status: 'deleted',
    });
    const [found] = findingsOf(diff, 'TEST_REMOVED');
    expect(found?.line).toBeNull();
    expect(found?.id).toBe('TEST_REMOVED:src/auth.test.ts');
  });

  /**
   * Every TEST_REMOVED finding on one reported patch was a case that had been
   * retitled, not removed. A case is what it asserts; matching on the title
   * alone reads a rename as a deletion.
   */
  it('treats a retitled case with a surviving body as surviving', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(
        [
          "-  it('rejects expired tokens', () => {",
          '-    const token = expired();',
          '-    expect(verify(token)).toBe(false);',
          "+  it('refuses tokens past their expiry', () => {",
          '+    const token = expired();',
          '+    expect(verify(token)).toBe(false);',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('TEST_REMOVED');
  });

  it('still reports a case whose body went with its title', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk(
        [
          "-  it('rejects expired tokens', () => {",
          '-    const token = expired();',
          '-    expect(verify(token)).toBe(false);',
          "+  it('does something else', () => {",
          '+    expect(other()).toBe(1);',
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'TEST_REMOVED')[0]?.message).toContain('rejects expired tokens');
  });

  it('names the case it is about, so an acknowledgement can be about one case', () => {
    const diff = diffOf(
      'src/auth.test.ts',
      hunk([" it('keeps this', () => {})", "-  it('rejects expired', () => {})"].join('\n')),
    );
    expect(findingsOf(diff, 'TEST_REMOVED')[0]?.subject).toBe('rejects expired');
  });

  it("names where a deleted file's cases went", () => {
    const diff =
      diffOf(
        'src/auth.test.ts',
        hunk(["-it('rejects expired', () => {})", "-it('accepts fresh', () => {})"].join('\n')),
        { status: 'deleted' },
      ) +
      diffOf(
        'src/auth/tokens.test.ts',
        hunk(["+it('rejects expired', () => {})", "+it('accepts fresh', () => {})"].join('\n')),
        { status: 'added' },
      );

    expect(findingsOf(diff, 'TEST_REMOVED')[0]?.message).toContain(
      'reappear in src/auth/tokens.test.ts',
    );
  });

  /**
   * Eight moved spec files are one decision. Eight findings are eight
   * acknowledgements, and a reviewer who has waved through six is not reading
   * the seventh.
   */
  it('collapses several moved spec files into one finding', () => {
    const moved = (n: number): string =>
      diffOf(`src/old/spec${n}.test.ts`, hunk(`-it('case ${n}', () => {})`), {
        status: 'deleted',
      }) +
      diffOf(`src/new/spec${n}.test.ts`, hunk(`+it('case ${n}', () => {})`), { status: 'added' });

    const found = findingsOf([1, 2, 3].map(moved).join(''), 'TEST_REMOVED');

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe('medium');
    expect(found[0]?.message).toContain('3 test files deleted');
    expect(found[0]?.message).toContain('src/old/spec1.test.ts -> src/new/spec1.test.ts');
    expect(found[0]?.file).toBe('src/old/spec1.test.ts');
  });

  it('leaves a file whose cases did not all land out of the collapsed finding', () => {
    const diff =
      diffOf('src/old/a.test.ts', hunk("-it('kept', () => {})"), { status: 'deleted' }) +
      diffOf('src/new/a.test.ts', hunk("+it('kept', () => {})"), { status: 'added' }) +
      diffOf('src/old/b.test.ts', hunk("-it('gone', () => {})"), { status: 'deleted' });

    const found = findingsOf(diff, 'TEST_REMOVED');
    expect(found.map((f) => f.severity).sort()).toEqual(['high', 'medium']);
    expect(found.find((f) => f.severity === 'high')?.message).toContain('gone');
  });

  it('recognises python and go declarations', () => {
    const py = diffOf('tests/test_auth.py', hunk('-def test_rejects_expired():'));
    expect(findingsOf(py, 'TEST_REMOVED')[0]?.message).toContain('test_rejects_expired');

    const go = diffOf('pkg/auth_test.go', hunk('-func TestRejects(t *testing.T) {'));
    expect(findingsOf(go, 'TEST_REMOVED')[0]?.message).toContain('TestRejects');
  });
});

describe('TEST_SKIPPED_ADDED', () => {
  it.each([
    ['src/a.test.ts', "+  it.skip('rejects', () => {})", '.skip'],
    ['src/a.test.ts', "+  xit('rejects', () => {})", 'x-prefixed'],
    ['src/a.test.ts', "+  describe.todo('later')", '.todo'],
    ['tests/test_a.py', '+@pytest.mark.skip(reason="flaky")', '@pytest.mark.skip'],
    ['tests/test_a.py', '+    pytest.skip("nope")', 'pytest.skip()'],
  ])('flags %s -> %s', (path, line, label) => {
    const [found] = findingsOf(diffOf(path, hunk(line)), 'TEST_SKIPPED_ADDED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain(label);
  });

  it('flags .only as silencing every other test', () => {
    const [found] = findingsOf(
      diffOf('src/a.test.ts', hunk("+  it.only('one', () => {})")),
      'TEST_SKIPPED_ADDED',
    );
    expect(found?.message).toContain('every other test');
  });

  it('reads go and rust markers in ordinary source files', () => {
    expect(rulesFor(diffOf('pkg/auth.go', hunk('+\tt.Skip("later")')))).toContain(
      'TEST_SKIPPED_ADDED',
    );
    expect(rulesFor(diffOf('src/lib.rs', hunk('+#[ignore]')))).toContain('TEST_SKIPPED_ADDED');
  });

  // Both of these came from running overlock against its own repository,
  // where they fired 28 times on documentation and test fixtures.
  it('does not read a language marker outside that language', () => {
    expect(rulesFor(diffOf('README.md', hunk('+| `t.Skip()` | skips a Go test |')))).not.toContain(
      'TEST_SKIPPED_ADDED',
    );
    expect(rulesFor(diffOf('src/rules.ts', hunk('+const re = /#\\[ignore\\]/;')))).not.toContain(
      'TEST_SKIPPED_ADDED',
    );
  });

  it('does not read a marker that is inside a string literal', () => {
    const fixture = diffOf('src/a.test.ts', hunk(`+  const sample = "it.skip('x', () => {})";`));
    expect(rulesFor(fixture)).not.toContain('TEST_SKIPPED_ADDED');

    const assertion = diffOf('src/a.test.ts', hunk("+  expect(diff).toContain('it.skip');"));
    expect(rulesFor(assertion)).not.toContain('TEST_SKIPPED_ADDED');
  });

  it('still reads a real marker whose title is a string', () => {
    const diff = diffOf('src/a.test.ts', hunk("+  it.skip('rejects expired tokens', () => {})"));
    expect(rulesFor(diff)).toContain('TEST_SKIPPED_ADDED');
  });

  it('ignores a skip marker inside a comment', () => {
    const diff = diffOf('src/a.test.ts', hunk('+  // we used to it.skip this one'));
    expect(rulesFor(diff)).not.toContain('TEST_SKIPPED_ADDED');
  });

  it('ignores a JS skip marker in a file that is not a test', () => {
    expect(rulesFor(diffOf('src/a.ts', hunk("+  it.skip('x', () => {})")))).not.toContain(
      'TEST_SKIPPED_ADDED',
    );
  });
});

describe('ASSERTION_WEAKENED', () => {
  it('fires when an exact matcher becomes an existence check on the same subject', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        ['-  expect(user.role).toBe("admin");', '+  expect(user.role).toBeDefined();'].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'ASSERTION_WEAKENED');
    expect(found?.severity).toBe('high');
    expect(found?.evidence.before).toContain('toBe("admin")');
    expect(found?.evidence.after).toContain('toBeDefined()');
  });

  it('does not pair assertions about different subjects', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        ['-  expect(user.role).toBe("admin");', '+  expect(other.thing).toBeDefined();'].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('ASSERTION_WEAKENED');
  });

  it('suppresses the expected-value finding on the same line', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(x).toBe(1);', '+  expect(x).toBeDefined();'].join('\n')),
    );
    const rules = rulesFor(diff);
    expect(rules).toContain('ASSERTION_WEAKENED');
    expect(rules).not.toContain('EXPECTED_VALUE_CHANGED');
  });
});

describe('ASSERTION_WEAKENED, on what counts as an existence check', () => {
  /**
   * Two of three findings on one real patch were this shape. `toBeNull()` names
   * a value as exactly as `toBe(false)` does, and reading it as an existence
   * check is a false positive on the rule that blocks by default.
   */
  it.each([
    ['toBeNull()', "-  expect(session.token).toBe('abc');", '+  expect(session.token).toBeNull();'],
    ['toBeUndefined()', '-  expect(cache.hit).toBe(1);', '+  expect(cache.hit).toBeUndefined();'],
    ['toBe(false)', '-  expect(flags.beta).toBe(1);', '+  expect(flags.beta).toBe(false);'],
  ])('does not read %s as one — it names a value', (_label, before, after) => {
    const diff = diffOf('src/a.test.ts', hunk([before, after].join('\n')));
    expect(rulesFor(diff)).not.toContain('ASSERTION_WEAKENED');
  });

  it('reads not.toBeNull() as one, because negation is what makes it vague', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        ['-  expect(user.role).toBe("admin");', '+  expect(user.role).not.toBeNull();'].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'ASSERTION_WEAKENED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('that a value is present');
  });

  it('says which loose thing the replacement checks', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(list).toHaveLength(3);', '+  expect(list).toBeTruthy();'].join('\n')),
    );
    expect(findingsOf(diff, 'ASSERTION_WEAKENED')[0]?.message).toContain(
      'only checks that a value is truthy',
    );
  });

  it('reads a placeholder inside an exact matcher as giving the value up', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "-  expect(save).toHaveBeenCalledWith('row', 42);",
          '+  expect(save).toHaveBeenCalledWith(expect.any(String), expect.any(Number));',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).toContain('ASSERTION_WEAKENED');
  });

  it('does not read adding a field beside an existing placeholder as one', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          '-  expect(row).toEqual({ id: expect.any(String) });',
          '+  expect(row).toEqual({ id: expect.any(String), createdAt: expect.any(Date) });',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('ASSERTION_WEAKENED');
  });
});

describe('ASSERTION_WEAKENED, on what counts as a pair', () => {
  /**
   * A hunk is a region of the file, not an edit. This one holds two test cases,
   * and pairing across the context line between them invents a weakening out of
   * a removal in the first and an addition in the second.
   */
  it('does not pair a removal and an addition in different cases', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "-    expect(store.value).toBe('kept');",
          '   });',
          "   it('reads it back', () => {",
          '+    expect(store.value).toBeDefined();',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('ASSERTION_WEAKENED');
  });

  it('does not read a moved assertion as a weakened one', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          '-    expect(total()).toBe(42);',
          '+    expect(total()).toBeDefined();',
          '   });',
          "   it('still checks the total', () => {",
          '+    expect(total()).toBe(42);',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('ASSERTION_WEAKENED');
  });

  it('does not report one loose addition as the answer to two removals', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          '-    expect(row.total).toBe(1);',
          '-    expect(row.total).toBe(2);',
          '+    expect(row.total).toBeDefined();',
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'ASSERTION_WEAKENED')).toHaveLength(1);
  });

  /**
   * The complaint this answers: a test that came out of the patch asserting
   * more than it did before read exactly like one that only lost specificity.
   */
  it('grades down when the case gained assertions overall', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "   it('cancels the lapse', () => {",
          '-    expect(row.state).toBe("lapsed");',
          '+    expect(row.state).toBeDefined();',
          '+    expect(store.writes).toHaveLength(1);',
          '+    expect(store.last).toEqual({ id: 1 });',
        ].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'ASSERTION_WEAKENED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('gained 2 assertions');
  });

  it('stays high when the case only lost specificity', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "   it('cancels the lapse', () => {",
          '-    expect(row.state).toBe("lapsed");',
          '+    expect(row.state).toBeDefined();',
        ].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'ASSERTION_WEAKENED');
    expect(found?.severity).toBe('high');
    expect(found?.message).not.toContain('gained');
  });
});

describe('ASSERTION_NARROWED', () => {
  /**
   * Same finding, different reason. The assertion still names a value; what it
   * stopped doing is covering the rest of the object — and a message that says
   * "only checks existence" sends a reader looking for the wrong edit.
   */
  it('fires when a whole-object assertion becomes one about a field', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "-    expect(row).toEqual({ id: 1, state: 'lapsed', lapsedAt: 5 });",
          '+    expect(row.lapsedAt).toBeNull();',
        ].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'ASSERTION_NARROWED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('row was checked as a whole, now only row.lapsedAt');
    expect(rulesFor(diff)).not.toContain('ASSERTION_WEAKENED');
  });

  it('fires when the same assertion checks fewer values', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "-    expect(save).toHaveBeenCalledWith('row', 42, true);",
          "+    expect(save).toHaveBeenCalledWith('row');",
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'ASSERTION_NARROWED')[0]?.message).toContain(
      '2 expected values checked, now 1',
    );
  });

  /** Lifting an expectation into a variable checks exactly as much as before. */
  it('does not fire when the expectation moved into a variable', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          '-    expect(row).toEqual({ id: 1, state: 2 });',
          '+    expect(row).toEqual(expected);',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('ASSERTION_NARROWED');
  });

  it('does not double-report the same edit as a value change', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(
        [
          "-    expect(save).toHaveBeenCalledWith('row', 42);",
          "+    expect(save).toHaveBeenCalledWith('row');",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('EXPECTED_VALUE_CHANGED');
  });
});

describe('PREDICATE_NARROWED', () => {
  /**
   * The case the rule was written for: every `expect` in the file is untouched
   * and the loop around them stops visiting four keys.
   */
  it('fires when a wrapped filter predicate gains a conjunct', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const free = FEATURE_KEYS.filter((key) => FEATURES[key].tier === 'free');",
          '+  const free = FEATURE_KEYS.filter(',
          "+    (key) => FEATURES[key].tier === 'free' && !NOT_SOLD_AT_FREE.includes(key),",
          '+  );',
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')[0]?.message).toContain(
      '!NOT_SOLD_AT_FREE.includes(key)',
    );
  });

  it('fires on a one-line filter that gained a conjunct', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const free = FEATURE_KEYS.filter((key) => FEATURES[key].tier === 'free');",
          "+  const free = FEATURE_KEYS.filter((key) => FEATURES[key].tier === 'free' && !NOT_SOLD_AT_FREE.includes(key));",
        ].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'PREDICATE_NARROWED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('!NOT_SOLD_AT_FREE.includes(key)');
  });

  /** A set a loop consumes decides how many times the assertions under it run. */
  it('fires high when the narrowed set is iterated', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  for (const key of FEATURE_KEYS.filter((k) => tier(k) === 'free')) {",
          "+  for (const key of FEATURE_KEYS.filter((k) => tier(k) === 'free' && !EXEMPT.has(k))) {",
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')[0]?.severity).toBe('high');
  });

  it('fires high when a parameterisation gains a filter it did not have', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          '-  it.each(FEATURE_KEYS)("%s is documented", (key) => {',
          '+  it.each(FEATURE_KEYS.filter((k) => !UNDOCUMENTED.includes(k)))("%s is documented", (key) => {',
        ].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'PREDICATE_NARROWED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('.filter(...) step');
  });

  it('fires when a literal table of cases loses rows', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  it.each(['free', 'pro', 'team', 'enterprise'])('%s is priced', (tier) => {",
          "+  it.each(['free', 'pro'])('%s is priced', (tier) => {",
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')[0]?.message).toContain(
      '4 values were iterated, now 2',
    );
  });

  /**
   * The third of the three, and the one a rename made visible only by accident:
   * a list of what is left out has one direction it can move in without costing
   * coverage.
   */
  it('fires when a named exclusion list grows', () => {
    const diff = diffOf(
      'src/catalog.test.ts',
      hunk(
        [
          "-  const NOT_SOLD_AT_FREE = ['seats', 'sso'];",
          "+  const NOT_SOLD_AT_FREE = ['seats', 'sso', 'auditLog'];",
        ].join('\n'),
      ),
    );
    const [found] = findingsOf(diff, 'PREDICATE_NARROWED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain("NOT_SOLD_AT_FREE exempts 1 more: 'auditLog'");
  });

  it('fires high when a forEach source gains a filter step', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          '-  FEATURE_KEYS.forEach((key) => {',
          '+  FEATURE_KEYS.filter((k) => !EXEMPT.has(k)).forEach((key) => {',
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')[0]?.severity).toBe('high');
  });

  it('fires when a for...of over a literal list loses members', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  for (const tier of ['free', 'pro', 'team']) {",
          "+  for (const tier of ['free', 'pro']) {",
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')[0]?.message).toContain(
      '3 values were iterated, now 2',
    );
  });

  it('stays quiet when a for...of gained a value as well as losing one', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  for (const tier of ['free', 'pro', 'team']) {",
          "+  for (const tier of ['free', 'enterprise']) {",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  it('stays quiet when a list of what is covered grows', () => {
    const diff = diffOf(
      'src/catalog.test.ts',
      hunk(
        [
          "-  const SOLD_AT_FREE = ['seats', 'sso'];",
          "+  const SOLD_AT_FREE = ['seats', 'sso', 'auditLog'];",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  it('stays quiet when an exclusion list shrinks', () => {
    const diff = diffOf(
      'src/catalog.test.ts',
      hunk(
        [
          "-  const KNOWN_FAILURES = ['seats', 'sso'];",
          "+  const KNOWN_FAILURES = ['seats'];",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  /** A predicate that gained an alternative covers more, not less. */
  it('stays quiet when a filter gained a disjunct', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const rows = ALL.filter((r) => r.tier === 'free');",
          "+  const rows = ALL.filter((r) => r.tier === 'free' || r.tier === 'pro');",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  it('stays quiet when a filter predicate was rewritten rather than tightened', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const rows = ALL.filter((r) => r.tier === 'free');",
          '+  const rows = ALL.filter((r) => isFree(r));',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  it('stays quiet when the filter is on a different collection', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const rows = ALL.filter((r) => r.tier === 'free');",
          "+  const seats = SEATS.filter((r) => r.tier === 'free' && r.active);",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  it('stays quiet in a file that is not a test', () => {
    const diff = diffOf(
      'src/plans.ts',
      hunk(
        [
          "-  const free = KEYS.filter((k) => tier(k) === 'free');",
          "+  const free = KEYS.filter((k) => tier(k) === 'free' && !EXEMPT.has(k));",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  /** A quote-blind bracket scan reads the parenthesis inside this string. */
  it('reads brackets around string contents correctly', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const rows = ALL.filter((r) => r.label !== '(all)');",
          "+  const rows = ALL.filter((r) => r.label !== '(all)' && r.active);",
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')[0]?.message).toContain('r.active');
  });

  /** One added line cannot answer for two removals. */
  it('claims each answering line once', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const a = ALL.filter((r) => r.tier === 'free');",
          "-  const a = ALL.filter((r) => r.tier === 'free');",
          "+  const a = ALL.filter((r) => r.tier === 'free' && r.active);",
        ].join('\n'),
      ),
    );
    expect(findingsOf(diff, 'PREDICATE_NARROWED')).toHaveLength(1);
  });

  it('pairs across a rename applied by the same patch', () => {
    const diff =
      diffOf(
        'src/plans.test.ts',
        hunk(
          [
            "-  const free = FEATURE_KEYS.filter((k) => tier(k) === 'free');",
            "+  const free = PLAN_KEYS.filter((k) => tier(k) === 'free' && !EXEMPT.has(k));",
          ].join('\n'),
        ),
      ) +
      diffOf(
        'src/plans.ts',
        hunk(
          [
            '-export const FEATURE_KEYS = [];',
            '-const a = FEATURE_KEYS;',
            '+export const PLAN_KEYS = [];',
            '+const a = PLAN_KEYS;',
          ].join('\n'),
        ),
      ) +
      diffOf(
        'src/catalog.ts',
        hunk(['-const b = FEATURE_KEYS;', '+const b = PLAN_KEYS;'].join('\n')),
      );
    expect(rulesFor(diff)).toContain('PREDICATE_NARROWED');
  });

  /**
   * A tightened filter inside an `expect(...)` is one edit, and the assertion
   * rules have already named it. Two reasons for it is not an improvement on one.
   */
  it('does not double-report an edit ASSERTION_NARROWED already named', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-    expect(rows.filter((r) => r.active)).toEqual(['a', 'b', 'c']);",
          "+    expect(rows.filter((r) => r.active && r.paid)).toEqual(['a']);",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).toContain('ASSERTION_NARROWED');
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
  });

  it('can be silenced by an inline directive like any other rule', () => {
    const diff = diffOf(
      'src/plans.test.ts',
      hunk(
        [
          "-  const free = KEYS.filter((k) => tier(k) === 'free');",
          "+  const free = KEYS.filter((k) => tier(k) === 'free' && !EXEMPT.has(k)); // overlock-ignore PREDICATE_NARROWED -- exempt keys are covered in exempt.test.ts",
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).not.toContain('PREDICATE_NARROWED');
    expect(analyze({ diff }).suppressed).toBe(1);
  });
});

describe('ASSERTION_REMOVED', () => {
  it('counts assertions lost across the file', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(a).toBe(1);', '-  expect(b).toBe(2);', '+  doSomething();'].join('\n')),
    );
    const [found] = findingsOf(diff, 'ASSERTION_REMOVED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('2 assertions');
  });

  it('stays quiet when assertions are replaced one for one', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(a).toBe(1);', '+  expect(a).toBe(2);'].join('\n')),
    );
    expect(rulesFor(diff)).not.toContain('ASSERTION_REMOVED');
  });

  it('does not double-report a deleted test file', () => {
    const diff = diffOf('src/a.test.ts', hunk('-  expect(a).toBe(1);'), { status: 'deleted' });
    expect(rulesFor(diff)).not.toContain('ASSERTION_REMOVED');
  });
});

describe('EXPECTED_VALUE_CHANGED', () => {
  it('fires when only the literal moved', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(total).toBe(100);', '+  expect(total).toBe(120);'].join('\n')),
    );
    const [found] = findingsOf(diff, 'EXPECTED_VALUE_CHANGED');
    expect(found?.severity).toBe('medium');
    expect(found?.message).toContain('100');
    expect(found?.message).toContain('120');
  });

  it('ignores a line that is not an assertion', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  const total = 100;', '+  const total = 120;'].join('\n')),
    );
    expect(rulesFor(diff)).not.toContain('EXPECTED_VALUE_CHANGED');
  });

  it('ignores a rewritten assertion whose shape changed', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  expect(total).toBe(100);', '+  expect(getTotal(cart)).toBe(100);'].join('\n')),
    );
    expect(rulesFor(diff)).not.toContain('EXPECTED_VALUE_CHANGED');
  });
});

describe('COVERAGE_THRESHOLD_LOWERED', () => {
  it('fires when a number goes down', () => {
    const diff = diffOf(
      'vitest.config.ts',
      hunk(['-        statements: 95,', '+        statements: 70,'].join('\n')),
    );
    const [found] = findingsOf(diff, 'COVERAGE_THRESHOLD_LOWERED');
    expect(found?.severity).toBe('high');
    expect(found?.message).toContain('95');
    expect(found?.message).toContain('70');
  });

  it('fires when a threshold is deleted outright', () => {
    const diff = diffOf('vitest.config.ts', hunk('-        branches: 90,'));
    expect(findingsOf(diff, 'COVERAGE_THRESHOLD_LOWERED')[0]?.message).toContain('removed');
  });

  it('stays quiet when a threshold goes up', () => {
    const diff = diffOf(
      'vitest.config.ts',
      hunk(['-        statements: 70,', '+        statements: 95,'].join('\n')),
    );
    expect(rulesFor(diff)).not.toContain('COVERAGE_THRESHOLD_LOWERED');
  });

  it('reads a threshold written inline rather than on its own line', () => {
    const diff = diffOf(
      'vitest.config.ts',
      hunk(
        [
          '-export default { test: { coverage: { statements: 95 } } };',
          '+export default { test: { coverage: { statements: 20 } } };',
        ].join('\n'),
      ),
    );
    expect(rulesFor(diff)).toContain('COVERAGE_THRESHOLD_LOWERED');
  });

  it('reads python coverage config', () => {
    const diff = diffOf(
      'pyproject.toml',
      hunk(['-fail_under = 90', '+fail_under = 60'].join('\n')),
    );
    expect(rulesFor(diff)).toContain('COVERAGE_THRESHOLD_LOWERED');
  });

  it('ignores numbers in ordinary source', () => {
    const diff = diffOf('src/app.ts', hunk(['-  lines: 95,', '+  lines: 10,'].join('\n')));
    expect(rulesFor(diff)).not.toContain('COVERAGE_THRESHOLD_LOWERED');
  });
});

describe('TEST_TIMEOUT_RAISED', () => {
  it('fires low when a timeout goes up', () => {
    const diff = diffOf(
      'src/a.test.ts',
      hunk(['-  it("slow", fn, timeout: 500)', '+  it("slow", fn, timeout: 30000)'].join('\n')),
    );
    const [found] = findingsOf(diff, 'TEST_TIMEOUT_RAISED');
    expect(found?.severity).toBe('low');
    expect(found?.message).toContain('30000');
  });

  it('fires when retries appear where there were none', () => {
    const diff = diffOf('vitest.config.ts', hunk('+    retry: 3,'));
    expect(findingsOf(diff, 'TEST_TIMEOUT_RAISED')[0]?.message).toContain('introduced');
  });

  it('reads a numeric separator as part of the number', () => {
    const diff = diffOf(
      'vitest.config.ts',
      hunk(['-    testTimeout: 5_000,', '+    testTimeout: 30_000,'].join('\n')),
    );
    const [found] = findingsOf(diff, 'TEST_TIMEOUT_RAISED');
    expect(found?.message).toContain('30000');
    expect(found?.message).not.toContain(' 30.');
  });

  it('stays quiet when a timeout goes down', () => {
    const diff = diffOf('src/a.test.ts', hunk(['-  timeout: 30000', '+  timeout: 500'].join('\n')));
    expect(rulesFor(diff)).not.toContain('TEST_TIMEOUT_RAISED');
  });
});

describe('SNAPSHOT_UPDATED_WITH_CODE', () => {
  it('fires when a snapshot and production code move together', () => {
    const diff =
      diffOf('src/__snapshots__/a.test.ts.snap', hunk('+exports[`renders 1`] = `<div/>`;')) +
      diffOf('src/component.tsx', hunk('+  return <div />;'));
    const [found] = findingsOf(diff, 'SNAPSHOT_UPDATED_WITH_CODE');
    expect(found?.severity).toBe('medium');
    expect(found?.file).toContain('.snap');
  });

  it('stays quiet when only the snapshot moved', () => {
    const diff = diffOf(
      'src/__snapshots__/a.test.ts.snap',
      hunk('+exports[`renders 1`] = `<div/>`;'),
    );
    expect(rulesFor(diff)).not.toContain('SNAPSHOT_UPDATED_WITH_CODE');
  });
});

describe('TEST_AND_IMPL_TOGETHER', () => {
  it('pairs a test with the implementation of the same name', () => {
    const diff =
      diffOf('src/login.test.ts', hunk('+  expect(login()).toBe(1);')) +
      diffOf('src/login.ts', hunk('+  return 1;'));
    const [found] = findingsOf(diff, 'TEST_AND_IMPL_TOGETHER');
    expect(found?.severity).toBe('low');
    expect(found?.message).toContain('src/login.ts');
  });

  it('never blocks by default', () => {
    const diff =
      diffOf('src/login.test.ts', hunk('+  expect(login()).toBe(1);')) +
      diffOf('src/login.ts', hunk('+  return 1;'));
    expect(analyze({ diff }).ok).toBe(true);
  });

  it('stays quiet when the names do not match', () => {
    const diff =
      diffOf('src/login.test.ts', hunk('+  expect(1).toBe(1);')) +
      diffOf('src/billing.ts', hunk('+  return 1;'));
    expect(rulesFor(diff)).not.toContain('TEST_AND_IMPL_TOGETHER');
  });
});

describe('TEST_AND_IMPL_TOGETHER and reformatting', () => {
  const reflow = (path: string): string =>
    diffOf(
      path,
      hunk(['-const value = {', '-  a: 1', '-};', '+const value = { a: 1 };'].join('\n')),
    );

  it('stays quiet when the implementation was only re-wrapped', () => {
    const diff =
      reflow('src/auth.ts') + diffOf('src/auth.test.ts', hunk("+  it('rejects', () => {})"));
    expect(rulesFor(diff)).not.toContain('TEST_AND_IMPL_TOGETHER');
  });

  it('stays quiet when the test file was only re-wrapped', () => {
    const diff =
      diffOf('src/auth.ts', hunk(['-const a = 1;', '+const a = 2;'].join('\n'))) +
      reflow('src/auth.test.ts');
    expect(rulesFor(diff)).not.toContain('TEST_AND_IMPL_TOGETHER');
  });

  it('still fires when both really changed', () => {
    const diff =
      diffOf('src/auth.ts', hunk(['-const a = 1;', '+const a = 2;'].join('\n'))) +
      diffOf('src/auth.test.ts', hunk("+  it('rejects', () => {})"));
    expect(rulesFor(diff)).toContain('TEST_AND_IMPL_TOGETHER');
  });
});
