// A Pi extension. After each edit or write it formats the file. When the agent is about to settle
// it formats and lints every file changed this session and sends the remaining errors back.
import { isEditToolResult, isWriteToolResult } from '@earendil-works/pi-coding-agent';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { formatFile, lintSession, repositoryRoot } from './lib/session-lint.mjs';

const MESSAGE_TYPE = 'oxc-config';

// Each continuation is another model request; an error the agent cannot fix must not loop forever.
export const MAX_CONTINUATIONS = 3;

// Pi tools accept `@path` and `~/path` as well as paths relative to the working directory.
function toolPath(cwd, path) {
	const bare = path.startsWith('@') ? path.slice(1) : path;
	const expanded = bare === '~' || bare.startsWith('~/') ? join(homedir(), bare.slice(1)) : bare;

	return resolve(cwd, expanded);
}

// The session header is written when the session is created, so files modified before it are not
// this session's work.
function sessionStart(sessionManager) {
	const startedAt = Date.parse(sessionManager.getHeader()?.timestamp ?? '');

	return Number.isNaN(startedAt) ? null : startedAt;
}

// The stricter config is a path relative to the repository root, set in `.pi/settings.json` as
// `{ "oxcConfig": { "ratchet": ".oxlint/ratchet.json" } }`.
function ratchetConfig(settings) {
	const ratchet = settings.oxcConfig?.ratchet;

	return typeof ratchet === 'string' && ratchet ? ratchet : undefined;
}

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function oxcConfig(pi) {
	let continuations = 0;

	pi.on('before_agent_start', () => {
		continuations = 0;
	});

	pi.on('tool_result', async (event, ctx) => {
		if (event.isError || !(isEditToolResult(event) || isWriteToolResult(event))) {
			return;
		}

		const { path } = event.input;

		if (typeof path !== 'string' || !path) {
			return;
		}

		await formatFile(await repositoryRoot(ctx.cwd), toolPath(ctx.cwd, path));
	});

	// Like Claude's Stop hook, this runs only when a run finishes on its own, not after an abort.
	pi.on('agent_before_settle', async (event, ctx) => {
		const since = sessionStart(ctx.sessionManager);

		if (event.outcome !== 'completed' || since === null) {
			return;
		}

		const root = await repositoryRoot(ctx.cwd);
		const result = await lintSession(root, since, { ratchet: ratchetConfig(pi.getSettings()) });

		if (!result) {
			return;
		}

		if (!result.blocking) {
			if (ctx.hasUI) {
				ctx.ui.notify(result.message, 'warning');
			}

			return;
		}

		if (continuations >= MAX_CONTINUATIONS) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`oxc-config: lint errors remain after ${MAX_CONTINUATIONS} attempts to fix them.\n\n${result.message}`,
					'error',
				);
			}

			return;
		}

		continuations += 1;

		return {
			entries: [
				...event.entries,
				{
					type: 'custom_message',
					customType: MESSAGE_TYPE,
					content: result.message,
					display: true,
				},
			],
			continue: true,
		};
	});
}
