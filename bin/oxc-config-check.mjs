#!/usr/bin/env node
// oxlint silently ignores unknown rule names while linting, so a typo'd rule is dead config.
// `--print-config` resolves every rule against its plugin and rejects the config instead.
import { spawnSync } from 'node:child_process';

import { resolveBin } from '../lib/resolve-bin.mjs';

const oxlint = resolveBin('oxlint');

const configs = process.argv.length > 2 ? process.argv.slice(2) : ['.oxlintrc.json'];

for (const config of configs) {
	// The diagnostic goes to stdout alongside the config dump, so it is replayed only on failure.
	const result = spawnSync(process.execPath, [oxlint, '--config', config, '--print-config'], {
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		console.error(`${config}:`);
		console.error(result.error?.message ?? `${result.stdout}${result.stderr}`.trimEnd());
		process.exit(1);
	}
}
