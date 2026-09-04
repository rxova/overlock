import { isSnapshotFile, sourceSubject, testSubject } from '../paths.js';
import { isReformatOnly } from '../substitution.js';
import type { Finding } from '../types.js';
import { finding, productionFiles, type Rule, type RuleContext } from './shared.js';

export const snapshotUpdatedWithCode: Rule = {
  rule: 'SNAPSHOT_UPDATED_WITH_CODE',
  run(ctx: RuleContext): Finding[] {
    const snapshots = ctx.files.filter((f) => isSnapshotFile(f.path) && f.status !== 'deleted');
    if (snapshots.length === 0) return [];

    const production = productionFiles(ctx);
    if (production.length === 0) return [];

    // A snapshot regenerated in the same patch as the code it snapshots records
    // the new behaviour as correct without anyone deciding that it is. On its
    // own it is routine; it is listed so it appears next to the other findings
    // when something else in the patch is also off.
    return snapshots.map((file) =>
      finding({
        rule: 'SNAPSHOT_UPDATED_WITH_CODE',
        severity: 'medium',
        file: file.path,
        line: 1,
        message: `Snapshot updated alongside ${production.length} changed source file${
          production.length === 1 ? '' : 's'
        }.`,
        fix_hint: 'Read the snapshot diff itself — it is the assertion, and it was rewritten.',
      }),
    );
  },
};

export const testAndImplTogether: Rule = {
  rule: 'TEST_AND_IMPL_TOGETHER',
  run(ctx: RuleContext): Finding[] {
    const production = productionFiles(ctx);
    if (production.length === 0) return [];

    // A file whose only delta is whitespace did not change in any sense this
    // rule means. It happens for real: a rename that shortens a name lets a
    // formatter re-join lines that no longer need wrapping, and firing on that
    // is true by the letter and false in spirit.
    const subjects = new Map(
      production.filter((f) => !isReformatOnly(f)).map((f) => [sourceSubject(f.path), f.path]),
    );
    const findings: Finding[] = [];

    for (const file of ctx.files) {
      if (!ctx.isTest(file.path) || file.status === 'deleted') continue;
      if (isReformatOnly(file)) continue;
      const subject = testSubject(file.path);
      if (!subject) continue;
      const impl = subjects.get(subject);
      if (!impl) continue;

      // Deliberately `low`, and deliberately never blocking: this is what
      // ordinary test-driven work looks like. It earns its place by being the
      // line that tells you *which* implementation change the other findings in
      // this patch are about.
      findings.push(
        finding({
          rule: 'TEST_AND_IMPL_TOGETHER',
          severity: 'low',
          file: file.path,
          line: 1,
          message: `Changed in the same patch as ${impl}.`,
          fix_hint: 'Normal for TDD. Worth a glance if anything else here is flagged.',
        }),
      );
    }

    return findings;
  },
};
