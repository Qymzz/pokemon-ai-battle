import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(here, 'player.html');

/** 把回放数据注入自包含 HTML，输出可直接双击打开的观战页 */
export async function renderReplay(replay) {
	const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
	const json = JSON.stringify(replay)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
	return template.replace('/*__REPLAY_DATA__*/', `window.__REPLAY__ = ${json};`);
}
