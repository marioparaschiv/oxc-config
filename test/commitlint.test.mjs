import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { resolveBin } from '../lib/resolve-bin.mjs';
import { linkPackage } from './link-package.mjs';

const commitlint = resolveBin('@commitlint/cli', 'commitlint');

const consumer = join(import.meta.dirname, 'fixtures/commitlint-consumer');

let unlink;

beforeAll(() => {
	unlink = linkPackage(consumer);
});

afterAll(() => {
	unlink();
});

function lintMessage(message) {
	return spawnSync(process.execPath, [commitlint], {
		cwd: consumer,
		input: message,
		encoding: 'utf8',
	});
}

it('rejects a message without a type', () => {
	const result = lintMessage('Add thing');

	expect(result.status).toBe(1);
	expect(result.stdout).toContain('type may not be empty [type-empty]');
});

it.each([
	'build',
	'chore',
	'ci',
	'docs',
	'feat',
	'fix',
	'perf',
	'refactor',
	'revert',
	'style',
	'test',
])('accepts the %s type', (type) => {
	expect(lintMessage(`${type}: add thing`).status).toBe(0);
});

it('rejects a type outside the list', () => {
	const result = lintMessage('wip: add thing');

	expect(result.status).toBe(1);
	expect(result.stdout).toContain('[type-enum]');
});
