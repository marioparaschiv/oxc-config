import { spawn } from 'node:child_process';

// Resolves with the exit status and output, so callers decide what a non-zero status means.
export function run(command, args, cwd, env) {
	return new Promise((done, fail) => {
		const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
		child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
		child.on('error', fail);
		child.on('close', (status) => done({ status, stdout, stderr }));
	});
}
