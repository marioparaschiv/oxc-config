import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

import { run } from './run.mjs';

const require = createRequire(import.meta.url);

function resolveBin(packageName, binName) {
	const manifestPath = require.resolve(`${packageName}/package.json`);

	return join(dirname(manifestPath), require(manifestPath).bin[binName]);
}

// Runs through `node` rather than the `.bin` shim, which `spawn` cannot start on Windows.
export function spawnBin(packageName, args, options, binName = packageName) {
	return spawnSync(process.execPath, [resolveBin(packageName, binName), ...args], {
		encoding: 'utf8',
		...options,
	});
}

// oxlint resolves the presets' JS plugins from the repository, where pnpm does not hoist this
// package's dependencies. A pnpm `.bin` shim adds them to NODE_PATH; without one, this does.
function dependencyPath() {
	const packageRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

	return [join(packageRoot, 'node_modules'), dirname(dirname(packageRoot)), process.env.NODE_PATH]
		.filter(Boolean)
		.join(delimiter);
}

export function runBin(packageName, args, cwd) {
	return run(process.execPath, [resolveBin(packageName, packageName), ...args], cwd, {
		...process.env,
		NODE_PATH: dependencyPath(),
	});
}
