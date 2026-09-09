import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.js';
import { parseDiff } from './diff.js';
import { explainPatch, isReformatOnly } from './substitution.js';
import { diffOf, hunk } from './__fixtures__/diffs.js';

/** One file's worth of a rename, in the shape git emits: removals then additions. */
function renamedFile(n: number): string {
  return diffOf(
    `src/mod${n}.test.ts`,
    hunk(
      [
        "-import { thing } from '@warehouserouting/core';",
        `-  it('warehouserouting handles ${n}', () => {`,
        `-    expect(warehouserouting.run(${n})).toBe(${n});`,
        "+import { thing } from '@routing/core';",
        `+  it('routing handles ${n}', () => {`,
        `+    expect(routing.run(${n})).toBe(${n});`,
      ].join('\n'),
    ),
  );
}

const rename = [1, 2, 3, 4].map(renamedFile).join('');

/**
 * The same rename, plus the one shape it genuinely changes the meaning of: an
 * identifier inside a string literal. It is a changed expected value by every
 * measure this tool has, which makes it the honest fixture for "marked, not
 * suppressed" — a renamed *case title* is no longer a finding at all, because
 * the case it names is still there under the new title.
 */
const renameWithLiteral =
  rename +
  diffOf(
    'src/mod5.test.ts',
    hunk(
      [
        "-    expect(label).toBe('warehouserouting core');",
        "+    expect(label).toBe('routing core');",
      ].join('\n'),
    ),
  );

describe('explainPatch', () => {
  it('infers a substitution the patch applies wholesale', () => {
    const { renames, label } = explainPatch(parseDiff(rename));

    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({ from: 'warehouserouting', to: 'routing', files: 4 });
    expect(label).toBe('warehouserouting -> routing');
  });

  it('folds casing variants into one rename', () => {
    const cased = [1, 2, 3]
      .map((n) =>
        diffOf(
          `src/cased${n}.ts`,
          hunk(
            [
              '-import { warehouserouting } from "./a";',
              '-const x = WarehouseRouting.of(1);',
              '+import { routing } from "./a";',
              '+const x = Routing.of(1);',
            ].join('\n'),
          ),
        ),
      )
      .join('');

    const { renames } = explainPatch(parseDiff(cased));
    expect(renames).toHaveLength(1);
    expect(renames[0]?.casings).toBe(2);
  });

  it('reports two independent renames, most frequent first', () => {
    const two = [1, 2, 3]
      .map((n) =>
        diffOf(
          `src/two${n}.ts`,
          hunk(
            [
              '-const a = alphaService.of(1);',
              '-const b = betaHelper.of(2);',
              '-const c = alphaService.of(3);',
              '+const a = alphaClient.of(1);',
              '+const b = betaUtil.of(2);',
              '+const c = alphaClient.of(3);',
            ].join('\n'),
          ),
        ),
      )
      .join('');

    const { renames } = explainPatch(parseDiff(two));
    expect(renames.map((r) => r.from)).toEqual(['alphaService', 'betaHelper']);
    expect(renames[0]?.count).toBeGreaterThan(renames[1]?.count ?? 0);
  });

  it('will not infer a rename from a single file', () => {
    expect(explainPatch(parseDiff(renamedFile(1))).renames).toEqual([]);
  });

  /**
   * One real edit used to collapse the whole inference, which turned a patch
   * that was 95% a rename back into a wall of unexplained findings. The edit is
   * kept out of the substitution instead: it is not attested anywhere else, so
   * nothing explains it and it stands on its own.
   */
  it('keeps a one-off edit out of the rename rather than dropping the rename', () => {
    const inconsistent =
      rename +
      diffOf(
        'src/other.ts',
        hunk(['-const a = warehouserouting;', '+const a = somethingElse;'].join('\n')),
      );

    const { renames, explainsEdit } = explainPatch(parseDiff(inconsistent));

    expect(renames.map((r) => r.to)).toEqual(['routing']);
    expect(explainsEdit('const a = warehouserouting;', 'const a = somethingElse;')).toBeNull();
  });

  /**
   * Splitting one concept into two is an ordinary refactor, and reading it as
   * twenty-two unrelated findings is how a reviewer ends up checking one change
   * twenty-two times.
   */
  it('infers a name that became two names', () => {
    const split = [1, 2, 3]
      .map((n) =>
        diffOf(
          `src/split${n}.ts`,
          hunk(
            [
              `-const a${n} = cloudSync.pull();`,
              `-const b${n} = cloudSync.push();`,
              `+const a${n} = cloudBackup.pull();`,
              `+const b${n} = multiDevice.push();`,
            ].join('\n'),
          ),
        ),
      )
      .join('');

    const { renames, label, explainsEdit } = explainPatch(parseDiff(split));

    expect(renames.map((r) => r.to).sort()).toEqual(['cloudBackup', 'multiDevice']);
    expect(label).toBe('cloudSync -> cloudBackup + multiDevice');
    expect(explainsEdit('const a = cloudSync.pull();', 'const a = cloudBackup.pull();')).toBe(
      'rename',
    );
    expect(explainsEdit('const b = cloudSync.push();', 'const b = multiDevice.push();')).toBe(
      'rename',
    );
  });

  /** Two is a split. Five is a name being edited, and nothing explains an edit. */
  it('will not infer a rename from a name replaced five different ways', () => {
    const scattered = ['one', 'two', 'three', 'four', 'five']
      .flatMap((word) =>
        [1, 2, 3].map((n) =>
          diffOf(
            `src/${word}${n}.ts`,
            hunk(
              [
                `-const x = manyTargets.of(${n});`,
                `-const y = manyTargets.of(${n});`,
                `-const z = manyTargets.of(${n});`,
                `+const x = becomes${word}.of(${n});`,
                `+const y = becomes${word}.of(${n});`,
                `+const z = becomes${word}.of(${n});`,
              ].join('\n'),
            ),
          ),
        ),
      )
      .join('');

    expect(explainPatch(parseDiff(scattered)).renames).toEqual([]);
  });

  it('never reads a changed literal as a rename', () => {
    const literals = [1, 2, 3]
      .map((n) =>
        diffOf(
          `src/lit${n}.test.ts`,
          hunk(['-    expect(total()).toBe(42);', '+    expect(total()).toBe(7);'].join('\n')),
        ),
      )
      .join('');

    expect(explainPatch(parseDiff(literals)).renames).toEqual([]);
  });
});

describe('isReformatOnly', () => {
  it('sees through a line the formatter re-joined', () => {
    const [file] = parseDiff(
      diffOf(
        'src/a.ts',
        hunk(
          [
            '-import {',
            '-  one,',
            '-  two,',
            '-} from "./x";',
            '+import { one, two, } from "./x";',
          ].join('\n'),
        ),
      ),
    );

    expect(file && isReformatOnly(file)).toBe(true);
  });

  it('does not call a real edit a reformat', () => {
    const [file] = parseDiff(
      diffOf('src/a.ts', hunk(['-const a = 1;', '+const a = 2;'].join('\n'))),
    );
    expect(file && isReformatOnly(file)).toBe(false);
  });
});

describe('a patch that is mostly a rename', () => {
  it('marks the findings the rename accounts for', () => {
    const report = analyze({ diff: renameWithLiteral });

    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.renames).toHaveLength(1);
    expect(report.explained).toBe(report.findings.length);
    expect(report.findings.every((f) => f.explained_by === 'warehouserouting -> routing')).toBe(
      true,
    );
  });

  /**
   * The whole point. A rename large enough to explain most of a patch is also
   * large enough to hide one real edit inside, and the residual is the answer a
   * reviewer is actually after.
   */
  it('leaves a real edit inside the rename unexplained, and blocking', () => {
    const tampered =
      rename +
      diffOf(
        'src/mod9.test.ts',
        hunk(
          [
            "-import { thing } from '@warehouserouting/core';",
            '-    expect(total()).toBe(42);',
            "+import { thing } from '@routing/core';",
            '+    expect(total()).toBeDefined();',
          ].join('\n'),
        ),
      );

    const report = analyze({ diff: tampered });
    const unexplained = report.findings.filter((f) => f.explained_by === undefined);

    expect(unexplained).toHaveLength(1);
    expect(unexplained[0]?.rule).toBe('ASSERTION_WEAKENED');
    expect(report.ok).toBe(false);
  });

  /**
   * The residual only works on findings that exist. A rule that pairs a
   * removal with an addition by their text sees two unrelated lines once a
   * rename has moved through the subject, fires nothing, and leaves nothing
   * for the residual to mark — which is a weakened assertion that reaches a
   * reviewer as silence. The pairing runs against the substituted pre-image
   * for exactly that reason.
   */
  it('sees a weakened assertion whose subject the rename moved', () => {
    const hidden =
      rename +
      diffOf(
        'src/mod9.test.ts',
        hunk(
          [
            '-    expect(warehouserouting.total()).toBe(42);',
            '+    expect(routing.total()).toBeDefined();',
          ].join('\n'),
        ),
      );

    const report = analyze({ diff: hidden });
    const unexplained = report.findings.filter((f) => f.explained_by === undefined);

    expect(unexplained).toHaveLength(1);
    expect(unexplained[0]?.rule).toBe('ASSERTION_WEAKENED');
    // Evidence is the patch as written, not the pre-image the pairing used.
    expect(unexplained[0]?.evidence.before).toContain('warehouserouting.total()');
    expect(unexplained[0]?.evidence.after).toContain('routing.total()');
    expect(report.ok).toBe(false);
  });

  it('sees an expected value edited under the same rename', () => {
    const hidden =
      rename +
      diffOf(
        'src/mod9.test.ts',
        hunk(
          [
            '-    expect(warehouserouting.total()).toBe(42);',
            '+    expect(routing.total()).toBe(7);',
          ].join('\n'),
        ),
      );

    const report = analyze({ diff: hidden });
    const unexplained = report.findings.filter((f) => f.explained_by === undefined);

    expect(unexplained.map((f) => f.rule)).toContain('EXPECTED_VALUE_CHANGED');
    expect(unexplained[0]?.message).toContain('42 → 7');
  });

  /**
   * The other half of the same coin: a line the rename fully explains must not
   * become a finding because the substitution made its shape match.
   */
  it('does not read the rename itself as a value change', () => {
    const report = analyze({ diff: rename });
    expect(report.findings.map((f) => f.rule)).not.toContain('EXPECTED_VALUE_CHANGED');
  });

  /**
   * An inferred substitution is a heuristic, and a heuristic that silenced
   * findings on its own would be a way to launder a real edit through a big
   * enough rename. Marking is not suppressing.
   */
  it('does not change severity or whether the patch blocks', () => {
    const report = analyze({ diff: renameWithLiteral, failOn: 'medium' });
    expect(report.explained).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
    expect(report.suppressed).toBe(0);
  });
});
