import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

// Installs this package into `directory` as npm would, so presets resolve through `extends`.
export function linkPackage(directory) {
	const scope = join(directory, 'node_modules/@marioparaschiv');

	mkdirSync(scope, { recursive: true });
	symlinkSync(root, join(scope, 'oxc-config'), 'dir');

	return () => rmSync(join(directory, 'node_modules'), { recursive: true, force: true });
}
