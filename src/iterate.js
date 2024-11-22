export function iterate(array, callback) {
	const result = [];
	if (array) {
		for (let i = 0; i < array.length; i += 1) {
			result.push(`${callback(array[i], i)}`);
		}
	}

	return result.join('');
};
