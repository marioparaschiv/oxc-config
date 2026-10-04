#!/usr/bin/env node
// oxlint silently ignores unknown rule names while linting, so a typo'd rule is dead config.
// `--print-config` resolves every rule against its plugin and rejects the config instead.
import { spawnBin } from '../lib/resolve-bin.mjs';

const configs = process.argv.length > 2 ? process.argv.slice(2) : ['.oxlintrc.json'];

for (const config of configs) {
	// The diagnostic goes to stdout alongside the config dump, so it is replayed only on failure.
	const result = spawnBin('oxlint', ['--config', config, '--print-config']);

	if (result.status !== 0) {
		console.error(`${config}:`);
		console.error(result.error?.message ?? `${result.stdout}${result.stderr}`.trimEnd());
		process.exit(1);
	}
}
