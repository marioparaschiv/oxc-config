#!/usr/bin/env node
// A Claude Code hook. As PostToolUse (Edit|Write|MultiEdit) it formats the edited file. As Stop it
// formats and lints every file changed this session, then blocks on the lint errors that remain.
import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

import { formatFile, lintSession, repositoryRoot } from '../lib/session-lint.mjs';

const {
	values: { ratchet },
} = parseArgs({ options: { ratchet: { type: 'string' } } });

function requireString(value, name) {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(
			`oxc-config-hook expected a non-empty string at \`${name}\` in its input.`,
		);
	}

	return value;
}

// Session start is the transcript's birth time; without it, changes made this session cannot be
// told from a tree that was already dirty.
function sessionStart(transcriptPath) {
	const birthtimeMs = statSync(transcriptPath, { throwIfNoEntry: false })?.birthtimeMs;

	// Filesystems without a birth time report 0.
	return birthtimeMs || null;
}

async function onStop(root, transcriptPath) {
	const since = sessionStart(transcriptPath);

	if (since === null) {
		return;
	}

	const result = await lintSession(root, since, { ratchet });

	if (!result) {
		return;
	}

	process.stdout.write(
		JSON.stringify(
			result.blocking
				? { decision: 'block', reason: result.message }
				: { systemMessage: result.message },
		),
	);
}

const payload = JSON.parse(readFileSync(0, 'utf8'));
const cwd = requireString(payload.cwd, 'cwd');
const root = await repositoryRoot(cwd);

switch (payload.hook_event_name) {
	case 'PostToolUse': {
		const filePath = requireString(payload.tool_input?.file_path, 'tool_input.file_path');

		await formatFile(root, resolve(cwd, filePath));
		break;
	}

	case 'Stop': {
		await onStop(root, requireString(payload.transcript_path, 'transcript_path'));
		break;
	}

	default: {
		throw new Error(
			`oxc-config-hook handles PostToolUse and Stop, not ${payload.hook_event_name}.`,
		);
	}
}
