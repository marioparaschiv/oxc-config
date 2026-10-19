import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';

import { linkPackage } from './link-package.mjs';

export const CLEAN = 'export function one(): number {\n\treturn 1;\n}\n';
export const UNFORMATTED = 'export function one(): number {\nreturn 1\n}\n';
export const WITH_ERROR = 'export function two(): number {\n\tdebugger;\n\n\treturn 2;\n}\n';
export const WITH_CONSOLE =
	"export function three(): number {\n\tconsole.log('three');\n\n\treturn 3;\n}\n";

function git(root, ...args) {
	const result = spawnSync(
		'git',
		['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
		{ cwd: root, encoding: 'utf8' },
	);

	expect(result.status, result.stderr).toBe(0);
}

/**
 * Creates a committed repository under a fresh temporary `base` directory, linked to this package,
 * with an `.oxlintrc.json` ignoring `*.gen.ts` and a `ratchet.json` turning `no-console` into an
 * error.
 */
export function createRepository() {
	const base = realpathSync(mkdtempSync(join(tmpdir(), 'oxc-config-hook-')));
	const root = join(base, 'repository');

	mkdirSync(join(root, 'src'), { recursive: true });

	writeFileSync(join(root, '.gitignore'), 'node_modules\n');
	writeFileSync(join(root, '.oxfmtrc.json'), '{ "useTabs": true, "singleQuote": true }\n');
	writeFileSync(
		join(root, '.oxlintrc.json'),
		JSON.stringify({
			extends: ['./node_modules/@marioparaschiv/oxc-config/base.json'],
			ignorePatterns: ['*.gen.ts'],
		}),
	);
	writeFileSync(
		join(root, 'ratchet.json'),
		JSON.stringify({ extends: ['./.oxlintrc.json'], rules: { 'no-console': 'error' } }),
	);
	writeFileSync(
		join(root, 'tsconfig.json'),
		JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }),
	);
	writeFileSync(join(root, 'src/committed.ts'), CLEAN);

	git(root, 'init', '--quiet');
	git(root, 'add', '.');
	git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'init');
	linkPackage(root);

	return { base, root, read: (path) => readFileSync(join(root, path), 'utf8') };
}
