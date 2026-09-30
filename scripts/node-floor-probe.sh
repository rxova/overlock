#!/usr/bin/env bash
# Runs on the engines floor (Node 20.11) after rxova-repo-config pack-smoke, as
# node-floor-smoke.yml's `extra-command`. pack-smoke proves the package imports;
# this proves the CLI — the product — runs there, against a real repository.
set -euo pipefail

work=$(mktemp -d)
(cd packages/overlock && npm pack --silent --pack-destination "$work" > /dev/null)

node --version
mkdir -p "$work/consumer" && cd "$work/consumer"
echo '{"name":"consumer","private":true,"type":"module"}' > package.json
npm install --no-audit --no-fund "$work"/*.tgz
npx --no-install overlock --version
node -e "import('overlock').then(m => {
  const r = m.analyze({ diff: '' });
  if (r.findings.length !== 0) throw new Error('empty diff produced findings');
  if (!Array.isArray(m.RULE_IDS) || m.RULE_IDS.length === 0) throw new Error('rule registry missing');
  if (!m.RULE_IDS.includes('TEST_SKIPPED_ADDED')) throw new Error('rule registry changed shape');
  console.log('library entry loads on the floor');
})"

# A skipped test added to a real repository must fail the run with exit 1.
mkdir -p "$work/probe" && cd "$work/probe"
git init -q --initial-branch=main .
git config user.email ci@example.com && git config user.name CI
mkdir -p src && printf 'export const check = () => true;\n' > src/a.ts
git add -A && git commit -q -m "init"
printf "it.skip('x', () => {});\n" > src/a.test.ts
set +e
"$work/consumer/node_modules/.bin/overlock" check --base auto --no-ledger
status=$?
set -e
test "$status" -eq 1 || { echo "expected exit 1, got $status"; exit 1; }
echo "the CLI flags a skipped test on the floor"
