import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLEAN, UNFORMATTED, WITH_CONSOLE, WITH_ERROR, createRepository } from './repository.mjs';
import oxcConfig, { MAX_CONTINUATIONS } from '../pi-extension.mjs';

// A settle pass runs oxfmt and type-aware oxlint for real.
vi.setConfig({ testTimeout: 20_000 });

const SESSION_START_MS = Date.parse('2026-01-01T00:00:00.000Z');
const EARLIER_ENTRY = { type: 'custom', customType: 'earlier', data: null };

let base;
let root;
let read;
let handlers;
let settings;
let ctx;

function write(path, content, { session = true } = {}) {
	const file = join(root, path);
	const seconds = SESSION_START_MS / 1000 + (session ? 60 : -3600);

	writeFileSync(file, content);
	utimesSync(file, seconds, seconds);
}

function toolResult(path, { toolName = 'edit', isError = false } = {}) {
	return handlers.tool_result(
		{ type: 'tool_result', toolName, input: { path }, content: [], isError },
		ctx,
	);
}

function settle(outcome = 'completed') {
	return handlers.agent_before_settle(
		{ type: 'agent_before_settle', outcome, entries: [EARLIER_ENTRY], continue: false },
		ctx,
	);
}

beforeEach(() => {
	({ base, root, read } = createRepository());

	handlers = {};
	settings = {};
	ctx = {
		cwd: root,
		hasUI: true,
		ui: { notify: vi.fn() },
		sessionManager: {
			getHeader: () => ({
				type: 'session',
				timestamp: new Date(SESSION_START_MS).toISOString(),
			}),
		},
	};

	oxcConfig({
		on: (event, handler) => {
			handlers[event] = handler;
		},
		getSettings: () => settings,
	});
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

it('formats only the file an edit or write changed, however Pi wrote its path', async () => {
	write('src/relative.ts', UNFORMATTED);
	write('src/at.ts', UNFORMATTED);
	write('src/absolute.ts', UNFORMATTED);
	write('src/other.ts', UNFORMATTED);

	await toolResult('src/relative.ts');
	await toolResult('@src/at.ts', { toolName: 'write' });
	await toolResult(join(root, 'src/absolute.ts'));

	expect(read('src/relative.ts')).toBe(CLEAN);
	expect(read('src/at.ts')).toBe(CLEAN);
	expect(read('src/absolute.ts')).toBe(CLEAN);
	expect(read('src/other.ts')).toBe(UNFORMATTED);
});

it('leaves files alone after failed edits, other tools and edits outside the repository', async () => {
	write('src/failed.ts', UNFORMATTED);
	write('src/read.ts', UNFORMATTED);
	writeFileSync(join(base, 'outside.ts'), UNFORMATTED);

	await toolResult('src/failed.ts', { isError: true });
	await toolResult('src/read.ts', { toolName: 'read' });
	await toolResult('../outside.ts');

	expect(read('src/failed.ts')).toBe(UNFORMATTED);
	expect(read('src/read.ts')).toBe(UNFORMATTED);
	expect(read('../outside.ts')).toBe(UNFORMATTED);
});

it('formats files changed this session on settle, leaves pre-session changes alone and passes when clean', async () => {
	write('src/committed.ts', `${UNFORMATTED}debugger;\n`, { session: false });
	write('src/created.ts', UNFORMATTED);

	expect(await settle()).toBeUndefined();
	expect(read('src/created.ts')).toBe(CLEAN);
	expect(read('src/committed.ts')).toBe(`${UNFORMATTED}debugger;\n`);
});

it('sends the remaining lint errors to the agent and continues, keeping earlier entries', async () => {
	write('src/broken.ts', WITH_ERROR);
	write('src/schema.gen.ts', WITH_ERROR);

	const { entries, continue: shouldContinue } = await settle();

	expect(shouldContinue).toBe(true);
	expect(entries).toHaveLength(2);
	expect(entries[0]).toBe(EARLIER_ENTRY);
	expect(entries[1]).toMatchObject({
		type: 'custom_message',
		customType: 'oxc-config',
		display: true,
	});
	expect(entries[1].content).toContain('Fix these before finishing');
	expect(entries[1].content).toContain('src/broken.ts:2:2:');
	expect(entries[1].content).toContain('[Error/eslint(no-debugger)]');
	expect(entries[1].content).not.toContain('schema.gen.ts');
});

it('does not lint when the run was aborted or the session has no start', async () => {
	write('src/broken.ts', WITH_ERROR);

	expect(await settle('aborted')).toBeUndefined();
	expect(await settle('error')).toBeUndefined();

	ctx.sessionManager.getHeader = () => null;

	expect(await settle()).toBeUndefined();
});

it('reports warnings to the user without continuing', async () => {
	writeFileSync(
		join(root, '.oxlintrc.json'),
		JSON.stringify({
			extends: ['./node_modules/@marioparaschiv/oxc-config/base.json'],
			rules: { 'no-console': 'warn' },
		}),
	);
	write('src/logged.ts', WITH_CONSOLE);

	expect(await settle()).toBeUndefined();
	expect(ctx.ui.notify).toHaveBeenCalledWith(
		expect.stringContaining('These are warnings, not blocking'),
		'warning',
	);

	ctx.hasUI = false;
	ctx.ui.notify.mockClear();

	expect(await settle()).toBeUndefined();
	expect(ctx.ui.notify).not.toHaveBeenCalled();
});

it('lints with the ratchet config from the oxcConfig setting', async () => {
	write('src/logged.ts', WITH_CONSOLE);

	expect(await settle()).toBeUndefined();

	settings = { oxcConfig: { ratchet: 'ratchet.json' } };

	const { entries } = await settle();

	expect(entries[1].content).toContain('src/logged.ts:2:2:');
	expect(entries[1].content).toContain('[Error/eslint(no-console)]');
});

it('stops continuing after repeated failures until the next prompt', async () => {
	write('src/broken.ts', WITH_ERROR);

	for (let attempt = 0; attempt < MAX_CONTINUATIONS; attempt++) {
		expect((await settle()).continue).toBe(true);
	}

	expect(await settle()).toBeUndefined();
	expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('no-debugger'), 'error');

	handlers.before_agent_start({ type: 'before_agent_start' }, ctx);

	expect((await settle()).continue).toBe(true);
});
