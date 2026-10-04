import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

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
