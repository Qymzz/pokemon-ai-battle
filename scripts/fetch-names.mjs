/**
 * 一次性脚本：从 PokeAPI 的 CSV 数据里抽取简体中文（zh-Hans）名称，
 * 生成 src/data/names.zh.json，供战报翻译层做英文名 -> 中文名映射。
 *
 * 用法：node scripts/fetch-names.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const ZH_HANS = '12';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/data/names.zh.json');

function toID(text) {
	return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
			continue;
		}
		if (ch === '"') {
			quoted = true;
		} else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (ch !== '\r') {
			field += ch;
		}
	}
	if (field || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

async function fetchCsv(name) {
	const res = await fetch(`${BASE}/${name}`);
	if (!res.ok) throw new Error(`下载 ${name} 失败：HTTP ${res.status}`);
	return parseCsv(await res.text());
}

/** 实体表：id -> 英文 identifier */
function buildEntityTable(rows) {
	const map = new Map();
	for (const [id, identifier] of rows.slice(1)) {
		if (id && identifier) map.set(id, identifier);
	}
	return map;
}

/** 名称表：实体 id -> 简体中文名 */
function buildNameTable(rows) {
	const map = new Map();
	for (const [entityId, langId, name] of rows.slice(1)) {
		if (langId === ZH_HANS && entityId && name) map.set(entityId, name);
	}
	return map;
}

/** 把「实体表 + 名称表」合并成 showdown id -> 中文名 */
function zip(entityRows, nameRows, store) {
	const entities = buildEntityTable(entityRows);
	const names = buildNameTable(nameRows);
	for (const [id, identifier] of entities) {
		const zh = names.get(id);
		if (!zh) continue;
		store[toID(identifier)] = zh;
	}
}

const tasks = [
	['pokemon_species.csv', 'pokemon_species_names.csv', 'species'],
	['moves.csv', 'move_names.csv', 'moves'],
	['abilities.csv', 'ability_names.csv', 'abilities'],
	['items.csv', 'item_names.csv', 'items'],
	['types.csv', 'type_names.csv', 'types'],
	['natures.csv', 'nature_names.csv', 'natures'],
];

const out = { meta: { source: BASE, language: 'zh-Hans', fetchedAt: new Date().toISOString() } };

for (const [entityFile, nameFile, key] of tasks) {
	const [entityRows, nameRows] = await Promise.all([fetchCsv(entityFile), fetchCsv(nameFile)]);
	out[key] = {};
	zip(entityRows, nameRows, out[key]);
	console.log(`${key}: ${Object.keys(out[key]).length} 条`);
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('已写入', OUT);
