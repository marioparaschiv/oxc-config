export async function total(values: number[]): Promise<number> {
	let sum = 0;
	values.forEach((value) => {
		sum += value;
	});
	debugger;

	return await sum;
}
