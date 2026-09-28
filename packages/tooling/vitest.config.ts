import { baseVitestConfig } from '@rxova/repo-config/vitest';

// The scripts sit at the package root rather than under src/. Every one of
// them is measured, with no opt-out: each exports its work as functions and
// runs it only behind an entry check, so there is nothing here that cannot be
// tested. A new file is covered by the glob the moment it is added, and held
// to the preset's 95% on every axis.
export default baseVitestConfig({
  root: import.meta.dirname,
  include: ['*.test.ts'],
  coverageInclude: ['*.ts'],
  exclude: ['*.test.ts', '*.config.ts'],
});
