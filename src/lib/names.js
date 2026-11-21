import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex, toID } from './showdown.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const names = JSON.parse(fs.readFileSync(path.resolve(here, '../data/names.zh.json'), 'utf8'));

const cache = new Map();

function lookup(table, key) {
	if (!key) return null;
	const id = toID(key);
	if (!id) return null;
	const cacheKey = `${table}:${id}`;
	if (cache.has(cacheKey)) return cache.get(cacheKey);
	const value = names[table]?.[id] ?? null;
	cache.set(cacheKey, value);
	return value;
}

/** 宝可梦中文名：先查全名（含形态），再退回基础形态，最后用英文名 */
export function zhSpecies(name) {
	if (!name) return '';
	const direct = lookup('species', name);
	if (direct) return direct;
	const species = Dex.species.get(name);
	if (species?.exists) {
		if (species.baseSpecies && species.baseSpecies !== species.name) {
			const base = lookup('species', species.baseSpecies);
			if (base) return base;
		}
		const baseId = lookup('species', species.id);
		if (baseId) return baseId;
	}
	return species?.exists ? species.name : String(name);
}

export function zhMove(name) {
	if (!name) return '';
	return lookup('moves', name) ?? Dex.moves.get(name)?.name ?? String(name);
}

export function zhItem(name) {
	if (!name) return '';
	return lookup('items', name) ?? Dex.items.get(name)?.name ?? String(name);
}

export function zhAbility(name) {
	if (!name) return '';
	return lookup('abilities', name) ?? Dex.abilities.get(name)?.name ?? String(name);
}

export function zhType(name) {
	if (!name) return '';
	return lookup('types', name) ?? String(name);
}

export function zhNature(name) {
	if (!name) return '';
	return lookup('natures', name) ?? String(name);
}

/** 立绘 id：优先 Dex 的 spriteid（能正确区分形态） */
export function spriteId(speciesName) {
	const species = Dex.species.get(speciesName);
	if (species?.exists) return species.spriteid;
	return toID(speciesName);
}
