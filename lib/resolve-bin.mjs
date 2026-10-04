import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Runs through `node` rather than the `.bin` shim, which `spawn` cannot start on Windows.
/**
 *
 */
export function resolveBin(name) {
	const manifestPath = require.resolve(`${name}/package.json`);

	return join(dirname(manifestPath), require(manifestPath).bin[name]);
}
