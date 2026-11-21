import { Dex } from './showdown.js';

/** Showdown 的 damageTaken 是「受击倍率表」，这里统一换算成 0 / 0.5 / 1 / 2 / 4 的倍率 */
export function typeMultiplier(moveType, defenderTypes) {
	let multiplier = 1;
	for (const type of defenderTypes) {
		const chart = Dex.types.get(type);
		if (!chart?.exists) continue;
		const taken = chart.damageTaken[moveType];
		if (taken === 1) multiplier *= 2;
		else if (taken === 2) multiplier *= 0.5;
		else if (taken === 3) multiplier *= 0;
	}
	return multiplier;
}

export function pokemonTypes(pokemonOrTypes) {
	if (typeof pokemonOrTypes === 'string') return [pokemonOrTypes];
	if (Array.isArray(pokemonOrTypes)) return pokemonOrTypes;
	return typeof pokemonOrTypes.getTypes === 'function' ? pokemonOrTypes.getTypes() : pokemonOrTypes.types;
}
