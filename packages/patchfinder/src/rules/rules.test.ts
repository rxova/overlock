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

  // Both of these came from running patchfinder against its own repository,
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
