import { RuleTester } from 'oxlint/plugins-dev';
import { describe, expect, it } from 'vitest';

import plugin from '../plugin.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

const withOptions = (options, cases) =>
	cases.map((testCase) => ({ ...testCase, options: [options] }));

const TELECORD_DATABASE = {
	schemas: '@telecord/db/schemas',
	allowedIn: ['packages/db/src', 'packages/test-utils/src'],
};

const TELECORD_DOMAINS = {
	domainRoots: ['packages/shared/src'],
	internals: ['schemas', 'lib', 'types'],
	composable: ['schemas'],
};

const TELECORD_IMPORTS = {
	alias: '~/',
	aliasRoots: ['apps/*/src'],
	relativeRoots: ['packages/*/src'],
};

const WEB_CONTROL_MODULE = 'apps/web/src/components/form/controls/a.tsx';

const DOMAIN_MODULE = 'packages/shared/src/gateway/lib.ts';
const SCHEMAS_MODULE = 'packages/shared/src/gateway/schemas.ts';

const APP_MODULE = 'apps/backend/src/api/modules/origins/service.ts';
const REPOSITORY_MODULE = 'packages/db/src/repositories/origins.ts';
const CLIENT_FACTORY_MODULE = 'apps/search-indexer/src/lib/database.ts';

ruleTester.run('no-raw-database-access', plugin.rules['no-raw-database-access'], {
	valid: withOptions(TELECORD_DATABASE, [
		{ code: "import { eq } from 'drizzle-orm';", filename: REPOSITORY_MODULE },
		{ code: "import { origins } from '@telecord/db/schemas';", filename: REPOSITORY_MODULE },
		{ code: "import origins from '@telecord/db/repositories/origins';", filename: APP_MODULE },
		{ code: "import db from '@telecord/db/client';", filename: APP_MODULE },
		{ code: "import type { Executor } from '@telecord/db/client';", filename: APP_MODULE },
		{ code: "import type { apiKey } from '@telecord/db/schemas';", filename: APP_MODULE },
		{ code: "import { type origins } from '@telecord/db/schemas';", filename: APP_MODULE },
		{
			code: "import * as schema from '@telecord/db/schemas';",
			filename: CLIENT_FACTORY_MODULE,
		},
		{
			code: "import { drizzle } from 'drizzle-orm/node-postgres';",
			filename: CLIENT_FACTORY_MODULE,
		},
		{
			code: "import { eq } from 'drizzle-orm';",
			filename: 'packages/db/tests/origins.test.ts',
		},
		{
			code: "import { origins } from '@telecord/db/schemas';",
			filename: 'apps/backend/tests/api/modules/origins.test.ts',
		},
		{
			code: "import { origins } from '@telecord/db/schemas';",
			filename: 'packages/test-utils/src/seed.ts',
		},
	]),
	invalid: withOptions(TELECORD_DATABASE, [
		{
			code: "import { eq } from 'drizzle-orm';",
			filename: APP_MODULE,
			errors: [
				{
					message:
						'Import `drizzle-orm` only inside `packages/db/src` or `packages/test-utils/src` - a query belongs on a repository, and a caller joins one by passing an `Executor` (AGENTS.md).',
				},
			],
		},
		{
			code: "import { and, inArray } from 'drizzle-orm';",
			filename: 'packages/search/src/query/index.ts',
			errors: [{ messageId: 'builder' }],
		},
		{
			code: "import { origins } from '@telecord/db/schemas';",
			filename: APP_MODULE,
			errors: [{ messageId: 'schemas' }],
		},
		{
			code: "import { type Origin, origins } from '@telecord/db/schemas';",
			filename: APP_MODULE,
			errors: [{ messageId: 'schemas' }],
		},
		{
			code: "import { sql } from 'drizzle-orm';",
			filename: 'apps/media/scripts/compress-status.ts',
			errors: [{ messageId: 'builder' }],
		},
	]),
});

ruleTester.run(
	'no-raw-database-access in a single-package layout',
	plugin.rules['no-raw-database-access'],
	{
		valid: withOptions({ schemas: '~/db/schema', allowedIn: ['src/db'] }, [
			{ code: "import { eq } from 'drizzle-orm';", filename: 'src/db/queries/users.ts' },
			{ code: "import { users } from '~/db/schema';", filename: 'src/db/queries/users.ts' },
			{ code: "import { users } from '~/db/schemata';", filename: 'src/routes/users.ts' },
			{ code: "import { users } from '~/db/schema';", filename: 'src/routes/users.test.ts' },
		]),
		invalid: withOptions({ schemas: '~/db/schema', allowedIn: ['src/db'] }, [
			{
				code: "import { eq } from 'drizzle-orm';",
				filename: 'src/routes/users.ts',
				errors: [{ messageId: 'builder' }],
			},
			{
				code: "import { users } from '~/db/schema/users';",
				filename: 'src/routes/users.ts',
				errors: [
					{
						message:
							'Import `~/db/schema` only inside `src/db` - reach a table through its repository rather than building the query here (AGENTS.md).',
					},
				],
			},
		]),
	},
);

ruleTester.run('no-cross-domain-internals', plugin.rules['no-cross-domain-internals'], {
	valid: withOptions(TELECORD_DOMAINS, [
		{ code: "import { MessageSchema } from '../entities';", filename: DOMAIN_MODULE },
		{ code: "import { POSTER_SUFFIX } from './constants';", filename: DOMAIN_MODULE },
		{ code: "import { MessageSchema } from '../entities/schemas';", filename: SCHEMAS_MODULE },
		{ code: "import { MessageSchema } from '../entities';", filename: SCHEMAS_MODULE },
		{
			code: "import { MessageSchema } from '../entities/schemas';",
			filename: 'apps/web/src/main.ts',
		},
	]),
	invalid: withOptions(TELECORD_DOMAINS, [
		{
			code: "import { MessageSchema } from '../entities/schemas';",
			filename: DOMAIN_MODULE,
			errors: [
				{
					message:
						"Import a domain through its index (`../entities`), never its internals (`../entities/schemas`) - the index is the domain's public API (AGENTS.md).",
				},
			],
		},
		{
			code: "import Identifier from '../entities/lib';",
			filename: DOMAIN_MODULE,
			errors: [{ messageId: 'internals' }],
		},
		{
			code: "import type { ExitMeta } from '../process/types';",
			filename: DOMAIN_MODULE,
			errors: [{ messageId: 'internals' }],
		},
		{
			code: "import Identifier from '../entities/lib';",
			filename: SCHEMAS_MODULE,
			errors: [
				{
					message:
						"Import a domain through its index (`../entities`), never its `lib`/`types` - a `schemas` module may only compose another domain's `schemas` (AGENTS.md).",
				},
			],
		},
		{
			code: "import type { ExitMeta } from '../process/types';",
			filename: SCHEMAS_MODULE,
			errors: [{ messageId: 'composedInternals' }],
		},
	]),
});

const LIBRARY_DOMAINS = {
	domainRoots: ['libs/*/src'],
	internals: ['model', 'impl'],
	composable: ['model'],
};

ruleTester.run(
	'no-cross-domain-internals in a multi-library layout',
	plugin.rules['no-cross-domain-internals'],
	{
		valid: withOptions(LIBRARY_DOMAINS, [
			{ code: "import { User } from '../users';", filename: 'libs/core/src/billing/impl.ts' },
			{
				code: "import { User } from '../users/model';",
				filename: 'libs/core/src/billing/model.ts',
			},
			{
				code: "import { User } from '../users/schemas';",
				filename: 'libs/core/src/billing/impl.ts',
			},
			{
				code: "import { User } from '../users/model';",
				filename: 'packages/core/src/billing/impl.ts',
			},
		]),
		invalid: withOptions(LIBRARY_DOMAINS, [
			{
				code: "import { User } from '../users/model';",
				filename: 'libs/core/src/billing/impl.ts',
				errors: [{ messageId: 'internals' }],
			},
			{
				code: "import { charge } from '../payments/impl';",
				filename: 'libs/web/src/billing/model.ts',
				errors: [{ messageId: 'composedInternals' }],
			},
		]),
	},
);

ruleTester.run(
	'no-cross-domain-internals when every internal is composable',
	plugin.rules['no-cross-domain-internals'],
	{
		valid: withOptions(
			{ domainRoots: ['src/domains'], internals: ['service'], composable: ['service'] },
			[
				{
					code: "import { charge } from '../payments/service';",
					filename: 'src/domains/billing/service.ts',
				},
				{
					code: "import { charge } from '../payments/';",
					filename: 'src/domains/billing/service.ts',
				},
			],
		),
		invalid: [],
	},
);

it('requires options on every layout rule', () => {
	for (const rule of [
		'consistent-import-paths',
		'no-cross-domain-internals',
		'no-raw-database-access',
	]) {
		expect(() => plugin.rules[rule].create({ options: [], filename: 'src/a.ts' })).toThrow(
			`oxc-config/${rule} needs an options object describing the repository layout.`,
		);
	}
});

const TS_MODULE = 'packages/shared/src/entities/lib.ts';

ruleTester.run('no-unknown-parameters', plugin.rules['no-unknown-parameters'], {
	valid: [
		{
			code: 'function isFoo(value: unknown): value is Foo { return true; }',
			filename: TS_MODULE,
		},
		{
			code: 'function assertFoo(value: unknown): asserts value is Foo {}',
			filename: TS_MODULE,
		},
		{ code: 'const isBar = (value: unknown): value is Bar => true;', filename: TS_MODULE },
		{
			code: 'class Guard { check(value: unknown): value is Baz { return true; } }',
			filename: TS_MODULE,
		},
		{
			code: '// UNKNOWN: narrowing at the boundary; anything can arrive here.\nfunction toApiError(error: unknown): ApiError { return error; }',
			filename: TS_MODULE,
		},
		{
			code: '// UNKNOWN: third-party callback hands us an opaque payload.\nexport function handle(payload: unknown): void {}',
			filename: TS_MODULE,
		},
		{
			code: '// UNKNOWN: deserialized from the wire before validation.\nexport const parse = (raw: unknown): Parsed => validate(raw);',
			filename: TS_MODULE,
		},
		{
			code: '// UNKNOWN: ingest boundary hands us an opaque payload.\ntype IngestHandler = (payload: unknown) => void;',
			filename: TS_MODULE,
		},
		{
			code: '// UNKNOWN: ingest boundary hands us an opaque payload.\nexport type IngestHandler = (payload: unknown) => void;',
			filename: TS_MODULE,
		},
		{
			code: 'type IngestHandler = (/* UNKNOWN: opaque payload */ payload: unknown) => void;',
			filename: TS_MODULE,
		},
		{
			code: 'type Options = {\n\t// UNKNOWN: the caller decides what a failure value means.\n\tonError: (error: unknown) => void;\n};',
			filename: TS_MODULE,
		},
		{
			code: 'type Options = {\n\t// UNKNOWN: dispatched by opcode; only the handler knows the shape.\n\thandle(payload: unknown): void;\n};',
			filename: TS_MODULE,
		},
		{
			code: 'type Options = {\n\tonError: (/* UNKNOWN: opaque failure value */ error: unknown) => void;\n};',
			filename: TS_MODULE,
		},
		{ code: 'function wrap(value: string, cause: unknown): void {}', filename: TS_MODULE },
		{ code: 'function typed(value: string): void {}', filename: TS_MODULE },
	],
	invalid: [
		{
			code: 'function handle(payload: unknown): void {}',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: '// A bare comment with no prefix.\nfunction handle(payload: unknown): void {}',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: '// UNKNOWN: justifies something far above.\nconst unrelated = 1;\n\nfunction handle(payload: unknown): void {}',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: 'function toApiError(error: unknown): ApiError { return error; }',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: 'type IngestHandler = (payload: unknown) => void;',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: '// A bare comment with no prefix.\ntype IngestHandler = (payload: unknown) => void;',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: '// UNKNOWN: justifies something far above.\nconst unrelated = 1;\n\ntype IngestHandler = (payload: unknown) => void;',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: 'type Options = {\n\tonError: (error: unknown) => void;\n};',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: 'type Options = {\n\t// A bare comment with no prefix.\n\tonError: (error: unknown) => void;\n};',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: 'type Options = {\n\t// UNKNOWN: justifies the member above, not the one below.\n\tretries: number;\n\tonError: (error: unknown) => void;\n};',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
	],
});

ruleTester.run('no-const-arrow-function', plugin.rules['no-const-arrow-function'], {
	valid: [
		{
			code: "export const handler: Handler<'channelDelete'> = async ({ args: [channel] }) => { drop(channel); };",
			filename: TS_MODULE,
		},
		{
			code: 'const enqueue: ProjectChangeEnqueue = async (messageIds, targetChangeId) => { push(messageIds, targetChangeId); };',
			filename: TS_MODULE,
		},
		{
			code: 'const partial: Handler = (typed: string, untyped) => { use(typed, untyped); };',
			filename: TS_MODULE,
		},
		{ code: 'const shorthand = (value: string) => value.trim();', filename: TS_MODULE },
	],
	invalid: [
		{
			code: 'const dispatch = async (operations: SearchDocumentOperation[]): Promise<void> => { await run(operations); };',
			filename: TS_MODULE,
			errors: [{ messageId: 'arrow' }],
		},
		{
			code: 'const onCallback = (payload: DispatchPayload) => { handle(payload); };',
			filename: TS_MODULE,
			errors: [{ messageId: 'arrow' }],
		},
		{
			code: 'const run: Runner = async (tx: Transaction) => { await tx.commit(); };',
			filename: TS_MODULE,
			errors: [{ messageId: 'arrow' }],
		},
		{
			code: 'const noop: Handler = () => { reset(); };',
			filename: TS_MODULE,
			errors: [{ messageId: 'arrow' }],
		},
		{
			code: 'const plain = () => { reset(); };',
			filename: TS_MODULE,
			errors: [{ messageId: 'arrow' }],
		},
	],
});

ruleTester.run('no-unknown-returns', plugin.rules['no-unknown-returns'], {
	valid: [
		{
			code: '// UNKNOWN: a dynamic dispatch table returns whatever the method returns.\ntype RpcMethodHandler = (params: string) => unknown;',
			filename: TS_MODULE,
		},
		{
			code: "// UNKNOWN: mirrors BullMQ's `Queue.add`, whose Job result is irrelevant here.\nfunction add(name: string): Promise<unknown> { return queue.add(name); }",
			filename: TS_MODULE,
		},
		{
			code: '// UNKNOWN: the transport is payload-agnostic.\nexport const dispatch = (name: string): unknown => run(name);',
			filename: TS_MODULE,
		},
		{
			code: 'function parse(raw: string): ParsedPayload { return decode(raw); }',
			filename: TS_MODULE,
		},
	],
	invalid: [
		{
			code: 'function parse(raw: string): unknown { return decode(raw); }',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: 'function load(raw: string): Promise<unknown> { return decode(raw); }',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: '// A bare comment with no prefix.\nfunction parse(raw: string): unknown { return decode(raw); }',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
		{
			code: '// UNKNOWN: justifies something far above.\nconst unrelated = 1;\n\nfunction parse(raw: string): unknown { return decode(raw); }',
			filename: TS_MODULE,
			errors: [{ messageId: 'unknown' }],
		},
	],
});

ruleTester.run('kebab-case-filename', plugin.rules['kebab-case-filename'], {
	valid: [
		{ code: 'const a = 1;', filename: 'apps/web/src/lib/streamed-query.ts' },
		{ code: 'const a = 1;', filename: 'apps/web/src/lib/client.ts' },
		{ code: 'const a = 1;', filename: 'apps/web/src/ai-reword.dialog.tsx' },
		{ code: 'const a = 1;', filename: 'apps/backend/tests/accounts.service.test.ts' },
		{ code: 'const a = 1;', filename: 'apps/web/src/routeTree.gen.ts' },
		{ code: 'const a = 1;', filename: 'apps/web/src/routes/__root.tsx' },
		{ code: 'const a = 1;', filename: 'apps/web/src/routes/origins/$id.tsx' },
	],
	invalid: [
		{
			code: 'const a = 1;',
			filename: 'apps/discord/src/events/channelCreate.ts',
			errors: [{ messageId: 'kebab' }],
		},
		{
			code: 'const a = 1;',
			filename: 'apps/web/src/lib/query/streamedQuery.ts',
			errors: [{ data: { expected: 'streamed-query.ts' }, messageId: 'kebab' }],
		},
		{
			code: 'const a = 1;',
			filename: 'apps/web/src/aiReword.dialog.tsx',
			errors: [{ messageId: 'kebab' }],
		},
		{
			code: 'const a = 1;',
			filename: 'apps/discord/src/events/channel_create.ts',
			errors: [{ data: { expected: 'channel-create.ts' }, messageId: 'kebab' }],
		},
	],
});

ruleTester.run('consistent-import-paths', plugin.rules['consistent-import-paths'], {
	valid: withOptions(TELECORD_IMPORTS, [
		{ code: "import a from './sibling';", filename: WEB_CONTROL_MODULE },
		{ code: "import a from '~/lib/utils';", filename: WEB_CONTROL_MODULE },
		{ code: "import a from 'react';", filename: WEB_CONTROL_MODULE },
		{ code: "import a from '../entities';", filename: DOMAIN_MODULE },
		{ code: "import a from './constants';", filename: DOMAIN_MODULE },
		{ code: "import a from '../cache';", filename: 'packages/db/src/managers/users.ts' },
	]),
	invalid: withOptions(TELECORD_IMPORTS, [
		{
			code: "import a from '../context';",
			filename: WEB_CONTROL_MODULE,
			errors: [
				{
					message:
						'Import across directories with `~/` (`~/components/form/context`), never `../` - `./` is for siblings only (AGENTS.md).',
				},
			],
			output: "import a from '~/components/form/context';",
		},
		{
			code: "export { a } from '../context';",
			filename: WEB_CONTROL_MODULE,
			errors: [{ messageId: 'parent' }],
			output: "export { a } from '~/components/form/context';",
		},
		{
			code: "import a from '~/entities';",
			filename: DOMAIN_MODULE,
			errors: [
				{
					message:
						'A `packages/*/src` is consumed from source, so `~/` resolves against the consuming package - use a relative import (AGENTS.md).',
				},
			],
		},
		{
			code: "import a from '~/cache';",
			filename: 'packages/db/src/managers/users.ts',
			errors: [{ messageId: 'packageAlias' }],
		},
	]),
});

const SINGLE_APP_IMPORTS = { alias: '@/', aliasRoots: ['src'] };

ruleTester.run(
	'consistent-import-paths in a single-app layout',
	plugin.rules['consistent-import-paths'],
	{
		valid: withOptions(SINGLE_APP_IMPORTS, [
			{ code: "import a from './sibling';", filename: 'src/components/button.tsx' },
			{ code: "import a from '@/lib/utils';", filename: 'src/components/button.tsx' },
			{ code: "import a from '../config';", filename: 'scripts/seed/run.ts' },
		]),
		invalid: withOptions(SINGLE_APP_IMPORTS, [
			{
				code: "import a from '../../lib/utils';",
				filename: 'src/components/forms/input.tsx',
				errors: [{ messageId: 'parent' }],
				output: "import a from '@/lib/utils';",
			},
		]),
	},
);

ruleTester.run('jsdoc-summary-only', plugin.rules['jsdoc-summary-only'], {
	valid: [
		{
			code: `/**
 * Folds a stored name to lowercase ASCII.
 *
 * @param column - The text column to fold.
 * @returns A folded expression.
 */
function a(column) {
	return column;
}`,
		},
		{
			code: `/**
 * Splits a user search string into terms that are safe to interpolate
 * straight into a query.
 *
 * @param input - The raw search string.
 */
function a(input) {
	return input;
}`,
		},
		{
			code: `/**
 * Looks up a chat.
 *
 * @example
 * const chat = find(1);
 *
 * if (chat) {
 * 	use(chat);
 * }
 *
 * @returns The chat.
 */
function find(id) {
	return id;
}`,
		},
		{
			code: `/**
 * Looks up a chat.
 *
 * @param id - The identifier of the chat, which is the primary key on the
 * chats table and not the platform-native identifier.
 * @returns The chat.
 */
function find(id) {
	return id;
}`,
		},
		{
			code: `/**
 * Builds a pattern.
 *
 * @example
 * \`\`\`ts
 * const p = build('a');
 *
 * console.log(p);
 * \`\`\`
 */
function build(term) {
	return term;
}`,
		},
		{
			code: `/**
 * Looks up a chat.
 *
 * @returns The chat, or \`undefined\` when no row matches. Callers must handle
 * the miss rather than assuming a row exists, because the selector is
 * populated lazily on first read.
 */
function find(id) {
	return id;
}`,
		},
		{ code: '/** Folds a name. */\nfunction a() {}' },
		{ code: '// Not a JSDoc block at all.\n\n// Another line.\nfunction a() {}' },
	],
	invalid: [
		{
			code: `/**
 * Splits a user search string into terms.
 *
 * Normalizes the text, then drops everything outside the safe set. Accents
 * are stripped rather than folded.
 *
 * @param input - The raw search string.
 */
function a(input) {
	return input;
}`,
			errors: [{ messageId: 'prose' }],
		},
		{
			code: `/**
 * Splits a user search string into terms that are safe to interpolate
 * straight into a query, after normalizing it and dropping every character
 * outside the safe set.
 *
 * @param input - The raw search string.
 */
function a(input) {
	return input;
}`,
			errors: [{ messageId: 'summary' }],
		},
		{
			code: `/**
 * Looks up a chat.
 *
 * @example
 * const chat = find(1);
 *
 * @returns The chat.
 *
 * Callers must handle a missing chat.
 */
function find(id) {
	return id;
}`,
			errors: [{ messageId: 'prose' }],
		},
	],
});
