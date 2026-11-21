import fs from 'node:fs/promises';
import path from 'node:path';
import { runBattle } from './engine/battle.js';
import { runDraft } from './engine/draft.js';
import { buildReplay } from './engine/protocol.js';
import { buildSpriteManifest } from './lib/sprites.js';
import { prngSeed } from './lib/seed.js';
import { createAgent } from './agents/index.js';
import { attachNarration } from './tts/narrate.js';
import { renderReplay } from './render/replay.js';

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const item = argv[i];
		if (!item.startsWith('--')) continue;
		const key = item.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const seed = args.seed ?? String(Math.floor(Math.random() * 1e6));
const maxTurns = Number(args.turns ?? 100);
const outDir = path.resolve(process.cwd(), args.out ?? 'out');

function player(kindArg, nameArg, fallbackName) {
	const [kind, profile] = String(kindArg ?? 'heuristic').split(':');
	return { name: nameArg ?? fallbackName, kind, profile };
}

const players = [
	player(args.p1, args.p1name, '赤红'),
	player(args.p2, args.p2name, '青绿'),
];

const numericSeed = Number(seed) || (Date.now() % 1000000);
const agents = players.map((p, i) =>
	createAgent(p.kind ?? 'heuristic', { profile: p.profile, seed: prngSeed(numericSeed, 7000 + i) })
);
players.forEach((p, i) => {
	p.agent = agents[i];
	p.voice = p.agent.voice ?? (i === 0 ? 'zh-CN-XiaoyiNeural' : 'zh-CN-XiaoxiaoNeural');
	p.voiceRate = p.agent.voiceRate ?? '+8%';
});

console.log(
	`开始对战：${players[0].name}(${players[0].kind}${players[0].profile ? ':' + players[0].profile : ''}) ` +
	`vs ${players[1].name}(${players[1].kind}${players[1].profile ? ':' + players[1].profile : ''})，seed=${seed}`
);

let draft = null;
let result;
try {
	if (!args['no-draft']) {
		console.log('进入 BP 阶段（各禁 2 只，蛇形选 6 只）…');
		draft = await runDraft({
			players,
			seed: numericSeed,
			poolSize: Number(args.pool ?? 18),
			bansPerSide: Number(args.bans ?? 2),
			teamSize: 6,
			maxLegendaries: Number(args.legends ?? 2),
			onWarning: message => console.log(message),
		});
		const picksOf = side => draft.actions.filter(a => a.kind === 'pick' && a.side === side).map(a => a.name).join('、');
		console.log(
			`BP 结束（池子 ${draft.pool.length} 只，含 ${draft.poolMeta.legendCount} 只传说）：` +
			`${players[0].name} [${picksOf('p1')}] vs ${players[1].name} [${picksOf('p2')}]`
		);
	}

	result = await runBattle({
		players,
		teams: draft ? [draft.teams.p1, draft.teams.p2] : null,
		seed,
		maxTurns,
		onWarning: message => console.log(message),
	});
} catch (error) {
	console.error(`对战启动失败：${error.message}`);
	process.exit(1);
}

const replay = buildReplay({ ...result });
if (draft) replay.draft = draft;
replay.meta.animatedSprites = await buildSpriteManifest(replay);

if (args.bgm) {
	try {
		const bgmPath = path.resolve(process.cwd(), String(args.bgm));
		const buffer = await fs.readFile(bgmPath);
		const ext = path.extname(bgmPath).toLowerCase();
		const mime = {
			'.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
		}[ext] || 'audio/mpeg';
		replay.meta.bgm = {
			name: path.basename(bgmPath),
			src: `data:${mime};base64,${buffer.toString('base64')}`,
		};
		console.log(`背景音乐已内嵌：${path.basename(bgmPath)}`);
	} catch (error) {
		console.error(`背景音乐读取失败：${error.message}（本次使用内置 8-bit 背景乐）`);
	}
}

if (!args['no-voice']) {
	await attachNarration(replay, players, {
		cacheDir: path.join(outDir, 'tts-cache'),
		onWarning: message => console.log(message),
	});
}
const html = await renderReplay(replay);
replay.rawLog = result.log;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const base = path.join(outDir, `replay-${seed}-${stamp}`);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(`${base}.json`, JSON.stringify(replay, null, 2), 'utf8');
await fs.writeFile(`${base}.html`, html, 'utf8');

console.log(`对局结束：${replay.result.winnerName} 获胜（${replay.result.turns} 回合）${result.timedOut ? ' · 触发回合上限判定' : ''}`);
if (replay.meta.usage) {
	const { calls, prompt_tokens, completion_tokens } = replay.meta.usage;
	console.log(`LLM 用量：${calls} 次调用，输入 ${prompt_tokens} / 输出 ${completion_tokens} tokens`);
}
console.log(`回放页面：${base}.html`);
console.log(`回放数据：${base}.json`);

if (args.open && !args['no-open']) {
	const { spawn } = await import('node:child_process');
	const htmlPath = `${base}.html`;
	const command = process.platform === 'win32'
		? ['cmd', ['/c', 'start', '', htmlPath]]
		: process.platform === 'darwin'
			? ['open', [htmlPath]]
			: ['xdg-open', [htmlPath]];
	spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref();
}
