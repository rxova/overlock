import { describe, expect, it } from 'vitest';
import {
  isCiConfig,
  isRunnerConfig,
  isSnapshotFile,
  isTestFile,
  isThresholdConfig,
  sourceSubject,
  testSubject,
} from './paths.js';

describe('isTestFile', () => {
  it.each([
    'src/auth.test.ts',
    'src/auth.spec.tsx',
    'src/__tests__/auth.ts',
    'tests/login.js',
    'test/login.js',
    'tests/test_login.py',
    'app/login_test.py',
    'pkg/handler_test.go',
    'src/LoginTest.java',
    'spec/login_spec.rb',
    'Auth/LoginTests.cs',
  ])('recognises %s', (path) => {
    expect(isTestFile(path)).toBe(true);
  });

  it.each(['src/auth.ts', 'src/latest.ts', 'src/contest.ts', 'README.md'])(
    'does not claim %s',
    (path) => {
      expect(isTestFile(path)).toBe(false);
    },
  );

  it('accepts extra patterns from --test-glob', () => {
    expect(isTestFile('checks/login.check.ts')).toBe(false);
    expect(isTestFile('checks/login.check.ts', [/\.check\.ts$/])).toBe(true);
  });

  it('does not treat a snapshot as a test file', () => {
    expect(isTestFile('src/__snapshots__/auth.test.ts.snap')).toBe(false);
    expect(isSnapshotFile('src/__snapshots__/auth.test.ts.snap')).toBe(true);
  });
});

describe('isThresholdConfig', () => {
  it.each(['vitest.config.ts', 'jest.config.js', 'package.json', 'pyproject.toml', '.coveragerc'])(
    'recognises %s',
    (path) => {
      expect(isThresholdConfig(path)).toBe(true);
    },
  );

  it('ignores ordinary source', () => {
    expect(isThresholdConfig('src/index.ts')).toBe(false);
  });
});

describe('subjects', () => {
  it.each([
    ['src/login.test.ts', 'login'],
    ['tests/test_login.py', 'login'],
    ['pkg/handler_test.go', 'handler'],
    ['spec/login_spec.rb', 'login'],
    ['src/LoginTest.java', 'login'],
    ['src/__tests__/session.ts', 'session'],
  ])('reduces %s to %s', (path, expected) => {
    expect(testSubject(path)).toBe(expected);
  });

  it('has no subject for a non-test file', () => {
    expect(testSubject('src/login.ts')).toBeNull();
  });

  it('reduces a source path to its stem', () => {
    expect(sourceSubject('src/deep/Login.tsx')).toBe('login');
  });
});

describe('isCiConfig', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/release.yaml',
    '.github/actions/setup/action.yml',
    'action.yml',
    '.gitlab-ci.yml',
    '.circleci/config.yml',
    'azure-pipelines.yml',
    'Jenkinsfile',
    'Makefile',
    'scripts/test.sh',
  ])('recognises %s', (path) => {
    expect(isCiConfig(path)).toBe(true);
  });

  it.each(['src/workflows.ts', 'docs/ci.md', 'config.yml'])('does not claim %s', (path) => {
    expect(isCiConfig(path)).toBe(false);
  });
});

describe('isRunnerConfig', () => {
  it.each([
    'vitest.config.ts',
    'packages/app/vitest.e2e.config.ts',
    'jest.config.js',
    'jest.config.json',
    '.mocharc.json',
    'package.json',
    'pyproject.toml',
    'pytest.ini',
    'tox.ini',
    'phpunit.xml',
  ])('recognises %s', (path) => {
    expect(isRunnerConfig(path)).toBe(true);
  });

  it.each(['tsup.config.ts', 'src/config.ts', 'README.md'])('does not claim %s', (path) => {
    expect(isRunnerConfig(path)).toBe(false);
  });
});
