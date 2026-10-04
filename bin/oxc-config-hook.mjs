#!/usr/bin/env node
// A Claude Code hook. As PostToolUse (Edit|Write|MultiEdit) it formats the edited file. As Stop it
// formats and lints every file changed this session, then blocks on the lint errors that remain.
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { spawnBin } from '../lib/resolve-bin.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_REPORT = 12_000;

const {
	values: { ratchet },
} = parseArgs({ options: { ratchet: { type: 'string' } } });

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });

	if (result.error) {
		throw result.error;
	}

	return result;
}

function runTool(name, args, cwd) {
	const result = spawnBin(name, args, { cwd, maxBuffer: MAX_BUFFER });

	if (result.error) {
		throw result.error;
	}

	return result;
}

function git(args, cwd) {
	const result = run('git', args, cwd);

	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	}

	return result.stdout;
}

function requireString(value, name) {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(
			`oxc-config-hook expected a non-empty string at \`${name}\` in its input.`,
		);
	}

	return value;
}

function repositoryRoot(cwd) {
	const result = run('git', ['rev-parse', '--show-toplevel'], cwd);

	return result.status === 0 ? result.stdout.trim() : cwd;
}

// oxfmt skips files it cannot format or is configured to ignore, and its exit code is ignored
// so a half-written file with a syntax error is left for the linter to report.
function format(root, files) {
	runTool('oxfmt', ['--no-error-on-unmatched-pattern', ...files], root);
}

// Session start is the transcript's birth time; without it, changes made this session cannot be
// told from a tree that was already dirty.
function sessionStart(transcriptPath) {
	const birthtimeMs = statSync(transcriptPath, { throwIfNoEntry: false })?.birthtimeMs;

	// Filesystems without a birth time report 0.
	return birthtimeMs || null;
}

// Scope is git-dirty plus mtime, properties of the file rather than of its writer, so with several
// agents in one worktree a session can be blocked by another agent's lint error.
function sessionFiles(root, since) {
	const tracked = git(['diff', '--name-only', '-z', '--diff-filter=d', 'HEAD'], root);
	const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], root);
	const files = new Set(`${tracked}${untracked}`.split('\0').filter(Boolean));

	return [...files].filter(
		(file) => (statSync(join(root, file), { throwIfNoEntry: false })?.mtimeMs ?? 0) >= since,
	);
}

function lintConfigArgs(root) {
	if (!ratchet) {
		return [];
	}

	// oxlint does not inherit `ignorePatterns` through `extends`, so the repository config's own
	// patterns are passed explicitly or the ratchet config would lint what the repository ignores.
	const printed = runTool('oxlint', ['--print-config'], root);

	if (printed.status !== 0) {
		throw new Error(`oxlint --print-config failed:\n${printed.stdout}${printed.stderr}`);
	}

	const { ignorePatterns } = JSON.parse(printed.stdout);

	return ['--config', ratchet, ...ignorePatterns.map((pattern) => `--ignore-pattern=${pattern}`)];
}

function onPostToolUse(root, cwd, filePath) {
	// git reports the root with symlinks resolved, so the edited path must be resolved to match.
	const file = relative(root, realpathSync(resolve(cwd, filePath)));

	if (file === '..' || file.startsWith(`..${sep}`) || isAbsolute(file)) {
		return;
	}

	format(root, [file]);
}

function onStop(root, transcriptPath) {
	const since = sessionStart(transcriptPath);

	if (since === null) {
		return;
	}

	const files = sessionFiles(root, since);

	if (files.length === 0) {
		return;
	}

	format(root, files);

	// `--fix`, not `--fix-dangerously`: the `consistent-type-assertions` autofix turns
	// `const x = {} as never` into `const x: never = {}`, which does not compile.
	const lint = runTool(
		'oxlint',
		[
			'--type-aware',
			'--fix',
			'--no-error-on-unmatched-pattern',
			...lintConfigArgs(root),
			...files,
		],
		root,
	);

	const output = `${lint.stdout}\n${lint.stderr}`.trim();

	if (!output) {
		return;
	}

	const report = output.slice(0, MAX_REPORT);

	// oxlint exits 0 when only warnings remain.
	if (lint.status === 0) {
		process.stdout.write(
			JSON.stringify({
				systemMessage: `Formatter and linter ran on your changed files. These are warnings, not blocking:\n\n${report}`,
			}),
		);

		return;
	}

	process.stdout.write(
		JSON.stringify({
			decision: 'block',
			reason: `Formatter and linter ran on your changed files. Fix these before finishing:\n\n${report}`,
		}),
	);
}

const payload = JSON.parse(readFileSync(0, 'utf8'));
const cwd = requireString(payload.cwd, 'cwd');
const root = repositoryRoot(cwd);

switch (payload.hook_event_name) {
	case 'PostToolUse': {
		onPostToolUse(
			root,
			cwd,
			requireString(payload.tool_input?.file_path, 'tool_input.file_path'),
		);
		break;
	}

	case 'Stop': {
		onStop(root, requireString(payload.transcript_path, 'transcript_path'));
		break;
	}

	default: {
		throw new Error(
			`oxc-config-hook handles PostToolUse and Stop, not ${payload.hook_event_name}.`,
		);
	}
}
