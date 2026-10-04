import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Runs through `node` rather than the `.bin` shim, which `spawn` cannot start on Windows.
/**
 *
 */
export function resolveBin(packageName, binName = packageName) {
	const manifestPath = require.resolve(`${packageName}/package.json`);

	return join(dirname(manifestPath), require(manifestPath).bin[binName]);
}
