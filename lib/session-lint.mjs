// The format and lint passes shared by the Claude Code hook and the Pi extension.
import { isAbsolute, join, relative, sep } from 'node:path';
import { realpathSync, statSync } from 'node:fs';

import { runBin } from './resolve-bin.mjs';
import { run } from './run.mjs';

const MAX_REPORT = 12_000;

async function git(args, cwd) {
	const result = await run('git', args, cwd);

	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	}

	return result.stdout;
}

export async function repositoryRoot(cwd) {
	const result = await run('git', ['rev-parse', '--show-toplevel'], cwd);

	return result.status === 0 ? result.stdout.trim() : cwd;
}

// oxfmt skips files it cannot format or is configured to ignore, and its exit code is ignored
// so a half-written file with a syntax error is left for the linter to report.
async function format(root, files) {
	await runBin('oxfmt', ['--no-error-on-unmatched-pattern', ...files], root);
}

// Formats one edited file, given as an absolute path, when it lies inside the repository.
export async function formatFile(root, path) {
	// git reports the root with symlinks resolved, so the edited path must be resolved to match.
	const file = relative(root, realpathSync(path));

	if (file === '..' || file.startsWith(`..${sep}`) || isAbsolute(file)) {
		return;
	}

	await format(root, [file]);
}

// Scope is git-dirty plus mtime, properties of the file rather than of its writer, so with several
// agents in one worktree a session can be blocked by another agent's lint error.
async function sessionFiles(root, since) {
	const tracked = await git(['diff', '--name-only', '-z', '--diff-filter=d', 'HEAD'], root);
	const untracked = await git(['ls-files', '--others', '--exclude-standard', '-z'], root);
	const files = new Set(`${tracked}${untracked}`.split('\0').filter(Boolean));

	return [...files].filter(
		(file) => (statSync(join(root, file), { throwIfNoEntry: false })?.mtimeMs ?? 0) >= since,
	);
}

async function lintConfigArgs(root, ratchet) {
	if (!ratchet) {
		return [];
	}

	// oxlint does not inherit `ignorePatterns` through `extends`, so the repository config's own
	// patterns are passed explicitly or the ratchet config would lint what the repository ignores.
	const printed = await runBin('oxlint', ['--print-config'], root);

	if (printed.status !== 0) {
		throw new Error(`oxlint --print-config failed:\n${printed.stdout}${printed.stderr}`);
	}

	const { ignorePatterns } = JSON.parse(printed.stdout);

	return ['--config', ratchet, ...ignorePatterns.map((pattern) => `--ignore-pattern=${pattern}`)];
}

/**
 * Formats and lints the files changed since `since` (epoch milliseconds), fixing what oxlint can.
 * Resolves to `null` when nothing remains, or to the remaining problems and whether they block.
 */
export async function lintSession(root, since, { ratchet } = {}) {
	const files = await sessionFiles(root, since);

	if (files.length === 0) {
		return null;
	}

	await format(root, files);

	// `--fix`, not `--fix-dangerously`: the `consistent-type-assertions` autofix turns
	// `const x = {} as never` into `const x: never = {}`, which does not compile.
	const lint = await runBin(
		'oxlint',
		[
			'--type-aware',
			// The default format changes when oxlint detects an agent; `unix` prints nothing when clean.
			'--format=unix',
			'--fix',
			'--no-error-on-unmatched-pattern',
			...(await lintConfigArgs(root, ratchet)),
			...files,
		],
		root,
	);

	const output = `${lint.stdout}\n${lint.stderr}`.trim();

	if (!output) {
		return null;
	}

	const report = output.slice(0, MAX_REPORT);

	// oxlint exits 0 when only warnings remain.
	return lint.status === 0
		? {
				blocking: false,
				message: `Formatter and linter ran on your changed files. These are warnings, not blocking:\n\n${report}`,
			}
		: {
				blocking: true,
				message: `Formatter and linter ran on your changed files. Fix these before finishing:\n\n${report}`,
			};
}
