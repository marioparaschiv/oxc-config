import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { resolveBin } from '../lib/resolve-bin.mjs';
import { linkPackage } from './link-package.mjs';

const oxlint = resolveBin('oxlint');

const consumer = join(import.meta.dirname, 'fixtures/consumer');
const presetsConsumer = join(import.meta.dirname, 'fixtures/presets-consumer');

const unlinks = [];

beforeAll(() => {
	unlinks.push(linkPackage(consumer), linkPackage(presetsConsumer));
});

afterAll(() => {
	for (const unlink of unlinks) {
		unlink();
	}
});

function lint(cwd) {
	const result = spawnSync(
		process.execPath,
		[oxlint, '--type-aware', '--format', 'json', 'src'],
		{
			cwd,
			encoding: 'utf8',
		},
	);

	const { diagnostics } = JSON.parse(result.stdout);

	return {
		status: result.status,
		reported: diagnostics.map(({ code, filename, severity, labels: [{ span }] }) => ({
			code,
			filename,
			severity,
			line: span.line,
		})),
	};
}

it('reports every kind of preset rule as an error in a consumer extending base.json', () => {
	const { status, reported } = lint(consumer);

	expect(status).toBe(1);
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

it('applies base.json, react.json and jsdoc.json together in one consumer', () => {
	const { status, reported } = lint(presetsConsumer);

	expect(status).toBe(1);
	expect(reported).toEqual(
		expect.arrayContaining([
			{ code: 'eslint(no-debugger)', filename: 'src/math.ts', severity: 'error', line: 14 },
			{
				code: 'oxc-config(no-unnecessary-usestate-type)',
				filename: 'src/counter.tsx',
				severity: 'error',
				line: 9,
			},
			{
				code: 'oxc-config(jsx-no-conditional-leak)',
				filename: 'src/counter.tsx',
				severity: 'error',
				line: 13,
			},
			{
				code: 'oxc-config(no-nested-links)',
				filename: 'src/counter.tsx',
				severity: 'error',
				line: 14,
			},
			{
				code: 'oxc-config(jsdoc-summary-only)',
				filename: 'src/math.ts',
				severity: 'error',
				line: 8,
			},
			{
				code: 'jsdoc-js(require-jsdoc)',
				filename: 'src/math.ts',
				severity: 'error',
				line: 1,
			},
		]),
	);
	expect(reported).toHaveLength(6);
});
