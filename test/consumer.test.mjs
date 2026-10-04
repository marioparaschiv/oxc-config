import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const manifestPath = require.resolve('oxlint/package.json');
const oxlint = join(dirname(manifestPath), require(manifestPath).bin.oxlint);

const root = join(import.meta.dirname, '..');
const consumer = join(import.meta.dirname, 'fixtures/consumer');
const consumerModules = join(consumer, 'node_modules');

beforeAll(() => {
	mkdirSync(join(consumerModules, '@marioparaschiv'), { recursive: true });
	symlinkSync(root, join(consumerModules, '@marioparaschiv/oxc-config'), 'dir');
});

afterAll(() => {
	rmSync(consumerModules, { recursive: true, force: true });
});

it('reports every kind of preset rule as an error in a consumer extending base.json', () => {
	const result = spawnSync(
		process.execPath,
		[oxlint, '--type-aware', '--format', 'json', 'src'],
		{
			cwd: consumer,
			encoding: 'utf8',
		},
	);

	const { diagnostics } = JSON.parse(result.stdout);

	const reported = diagnostics.map(({ code, filename, severity, labels: [{ span }] }) => ({
		code,
		filename,
		severity,
		line: span.line,
	}));

	expect(result.status).toBe(1);
	expect(reported).toEqual(
		expect.arrayContaining([
			{
				code: 'eslint(no-debugger)',
				filename: 'src/violations.ts',
				severity: 'error',
				line: 6,
			},
			{
				code: 'stylistic(padding-line-between-statements)',
				filename: 'src/violations.ts',
				severity: 'error',
				line: 3,
			},
			{
				code: 'oxc-config(no-foreach)',
				filename: 'src/violations.ts',
				severity: 'error',
				line: 3,
			},
			{
				code: 'typescript(await-thenable)',
				filename: 'src/violations.ts',
				severity: 'error',
				line: 8,
			},
		]),
	);
	expect(reported).toHaveLength(4);
});
