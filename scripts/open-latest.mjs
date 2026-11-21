import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'out');

const entries = await fs.readdir(outDir).catch(() => []);
const htmlFiles = entries.filter(name => name.endsWith('.html'));
if (!htmlFiles.length) {
	console.log('还没有找到回放文件。');
	console.log('请先双击「一键对战.cmd」跑一局。');
	process.exit(1);
}

const withTime = await Promise.all(htmlFiles.map(async name => ({
	name,
	time: (await fs.stat(path.join(outDir, name))).mtimeMs,
})));
withTime.sort((a, b) => b.time - a.time);
const target = path.join(outDir, withTime[0].name);

console.log(`正在打开：${withTime[0].name}`);
const command = process.platform === 'win32'
	? ['cmd', ['/c', 'start', '', target]]
	: process.platform === 'darwin'
		? ['open', [target]]
		: ['xdg-open', [target]];
spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref();
