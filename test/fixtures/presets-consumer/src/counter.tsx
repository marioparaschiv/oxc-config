import { useState } from 'react';

/**
 * Renders a counter inside a link.
 *
 * @returns The counter.
 */
export function Counter() {
	const [count] = useState<number>(0);

	return (
		<a href='/outer'>
			{count && <span>{count}</span>}
			<a href='/inner'>inner</a>
		</a>
	);
}
