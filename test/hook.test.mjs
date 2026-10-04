import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkPackage } from './link-package.mjs';

// A stop pass runs oxfmt and type-aware oxlint for real, several times in the ratchet test.
vi.setConfig({ testTimeout: 20_000 });

const hook = join(import.meta.dirname, '../bin/oxc-config-hook.mjs');

const CLEAN = 'export function one(): number {\n\treturn 1;\n}\n';
const UNFORMATTED = 'export function one(): number {\nreturn 1\n}\n';
const WITH_ERROR = 'export function two(): number {\n\tdebugger;\n\n\treturn 2;\n}\n';
const WITH_CONSOLE =
	"export function three(): number {\n\tconsole.log('three');\n\n\treturn 3;\n}\n";

let base;
let root;
let transcript;
let sessionStartSeconds;

function git(...args) {
	const result = spawnSync(
		'git',
		['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args],
		{ cwd: root, encoding: 'utf8' },
	);

	expect(result.status, result.stderr).toBe(0);
}

// Session files are stamped after the transcript's birth and pre-session files well before it,
// since birth time itself cannot be set.
function write(path, content, { session = true } = {}) {
	const file = join(root, path);
	const time = session ? sessionStartSeconds + 60 : sessionStartSeconds - 3600;

	writeFileSync(file, content);
	utimesSync(file, time, time);
}

function read(path) {
	return readFileSync(join(root, path), 'utf8');
}

function runHook(payload, args = []) {
	const result = spawnSync(process.execPath, [hook, ...args], {
		input: JSON.stringify({ cwd: root, ...payload }),
		encoding: 'utf8',
	});

	expect(result.status, result.stderr).toBe(0);

	return result.stdout;
}

function postToolUse(path) {
	return runHook({
		hook_event_name: 'PostToolUse',
		tool_name: 'Edit',
		tool_input: { file_path: join(root, path) },
	});
}

function stop(args) {
	return runHook(
		{ hook_event_name: 'Stop', transcript_path: transcript, stop_hook_active: false },
		args,
	);
}

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), 'oxc-config-hook-')));
	root = join(base, 'repository');
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

	git('init', '--quiet');
	git('add', '.');
	git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '-m', 'init');
	linkPackage(root);

	transcript = join(base, 'transcript.jsonl');
	writeFileSync(transcript, '');
	sessionStartSeconds = statSync(transcript).birthtimeMs / 1000;
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

it('formats only the edited file after a tool use', () => {
	write('src/edited.ts', UNFORMATTED);
	write('src/other.ts', UNFORMATTED);

	expect(postToolUse('src/edited.ts')).toBe('');
	expect(read('src/edited.ts')).toBe(CLEAN);
	expect(read('src/other.ts')).toBe(UNFORMATTED);
});

it('leaves a file oxfmt cannot format untouched after a tool use', () => {
	write('notes.txt', 'some  notes\n');
	write('src/broken.ts', 'export function (\n');

	expect(postToolUse('notes.txt')).toBe('');
	expect(postToolUse('src/broken.ts')).toBe('');
	expect(read('notes.txt')).toBe('some  notes\n');
	expect(read('src/broken.ts')).toBe('export function (\n');
});

it('formats files changed this session on stop, leaves pre-session changes alone and passes when clean', () => {
	write('src/committed.ts', `${UNFORMATTED}debugger;\n`, { session: false });
	write('src/created.ts', UNFORMATTED);

	expect(stop()).toBe('');
	expect(read('src/created.ts')).toBe(CLEAN);
	expect(read('src/committed.ts')).toBe(`${UNFORMATTED}debugger;\n`);
});

it('fixes what it can on stop and blocks with the remaining lint errors', () => {
	write('src/broken.ts', 'export function two(): number {\n\tdebugger;\n\treturn 2;\n}\n');

	const { decision, reason } = JSON.parse(stop());

	expect(decision).toBe('block');
	expect(reason).toContain('src/broken.ts:2:2: error eslint(no-debugger)');
	expect(reason).not.toContain('padding-line-between-statements');
	expect(read('src/broken.ts')).toBe(WITH_ERROR);
});

it('skips the stop pass when the transcript cannot be read', () => {
	write('src/broken.ts', WITH_ERROR);
	transcript = join(base, 'missing.jsonl');

	expect(stop()).toBe('');
});

it('skips files matched by the repository ignorePatterns on stop', () => {
	write('src/schema.gen.ts', WITH_ERROR);
	write('src/broken.ts', WITH_ERROR);

	const { decision, reason } = JSON.parse(stop());

	expect(decision).toBe('block');
	expect(reason).toContain('src/broken.ts:2:2: error eslint(no-debugger)');
	expect(reason).not.toContain('schema.gen.ts');
});

it('lints with the ratchet config when given, still honouring the repository ignorePatterns', () => {
	write('src/logged.ts', WITH_CONSOLE);
	write('src/logged.gen.ts', WITH_CONSOLE);

	expect(stop()).toBe('');

	const { decision, reason } = JSON.parse(stop(['--ratchet', 'ratchet.json']));

	expect(decision).toBe('block');
	expect(reason).toContain('src/logged.ts:2:2: error eslint(no-console)');
	expect(reason).not.toContain('logged.gen.ts');
});
