import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const userArgs = process.argv.slice(2);
const isDoubleClick = userArgs.length === 0;

const defaults = [
	'--p1', 'llm:doubao',
	'--p2', 'llm:deepseek',
	'--p1name', '豆包',
	'--p2name', 'DeepSeek',
];
const args = isDoubleClick ? [...defaults] : [...userArgs];
if (!args.includes('--open') && !args.includes('--no-open')) args.push('--open');

// 如果 assets 目录里有 bgm.*，自动当背景音乐用
if (!args.includes('--bgm')) {
	for (const name of ['bgm.mp3', 'bgm.m4a', 'bgm.ogg', 'bgm.wav']) {
		const file = path.join(root, 'assets', name);
		if (fs.existsSync(file)) {
			args.push('--bgm', file);
			break;
		}
	}
}

if (isDoubleClick) {
	console.log('正在启动对局：豆包 vs DeepSeek');
	console.log('先跑 BP，再打 6v6，最后生成语音解说，通常 2~3 分钟，跑完会自动打开回放页面…\n');
} else {
	console.log('启动对局…\n');
}

const child = spawn(process.execPath, [path.join(root, 'src', 'index.js'), ...args], {
	cwd: root,
	stdio: 'inherit',
});

child.on('exit', code => {
	if (code !== 0) {
		console.error('\n对战失败，请检查上面的报错信息。');
		process.exitCode = code;
	}
});
