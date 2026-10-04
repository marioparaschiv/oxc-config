import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const check = join(root, 'bin/oxc-config-check.mjs');

const runCheck = (cwd, configs) =>
	spawnSync(process.execPath, [check, ...configs], { cwd, encoding: 'utf8' });

it('accepts every preset', () => {
	expect(runCheck(root, ['base.json', 'react.json', 'jsdoc.json']).status).toBe(0);
});

it('rejects a config naming an unknown rule with the oxlint diagnostic', () => {
	const result = runCheck(root, ['base.json', 'test/fixtures/unknown-rule/.oxlintrc.json']);

	expect(result.status).toBe(1);
	expect(result.stderr).toContain('test/fixtures/unknown-rule/.oxlintrc.json:');
	expect(result.stderr).toContain("Rule 'no-for-each' not found in plugin 'oxc-config'");
});

it('checks .oxlintrc.json in the working directory by default', () => {
	const result = runCheck(join(import.meta.dirname, 'fixtures/unknown-rule'), []);

	expect(result.status).toBe(1);
	expect(result.stderr).toContain("Rule 'no-for-each' not found in plugin 'oxc-config'");
});
