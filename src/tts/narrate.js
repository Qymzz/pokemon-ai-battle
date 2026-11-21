import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { synthesize } from './edge.js';

const MAX_CHARS = 90;
const CONCURRENCY = 4;

/** 把长思考裁成适合朗读的长度，尽量断在标点处 */
function speechText(text) {
	const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
	if (cleaned.length <= MAX_CHARS) return cleaned;
	const slice = cleaned.slice(0, MAX_CHARS);
	const cut = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('，'), slice.lastIndexOf('；'), slice.lastIndexOf('！'));
	if (cut > 20) return slice.slice(0, cut + 1);
	return `${slice}…`;
}

function collectJobs(replay, players) {
	const jobs = [];
	const voices = players.map(p => p.voice);
	const rates = players.map(p => p.voiceRate ?? '+8%');
	const push = (target, side, text) => {
		const speech = speechText(text);
		if (!speech) return;
		const index = Number(side.slice(1)) - 1;
		jobs.push({
			target,
			side,
			text: speech,
			voice: voices[index] ?? voices[0],
			rate: rates[index] ?? '+8%',
		});
	};

	for (const action of replay.draft?.actions ?? []) {
		push(action, action.side, action.thought || action.reason);
	}
	for (const beat of replay.beats ?? []) {
		if (beat.kind !== 'turn') continue;
		for (const decision of beat.decisions ?? []) {
			// 思考与动作不一致的条目跳过朗读，避免读出来的内容和实际动作矛盾
			if (decision.inconsistent) continue;
			push(decision, decision.side, decision.thought || decision.reason);
		}
	}
	return jobs;
}

/**
 * 为 BP 动作和每回合决策生成语音，以 data URI 内嵌进回放数据。
 * 同样的文本 + 音色会命中磁盘缓存，重复跑局不用重新合成。
 */
export async function attachNarration(replay, players, { cacheDir, onWarning = () => {} }) {
	const jobs = collectJobs(replay, players);
	if (!jobs.length) return 0;

	console.log(`生成语音解说：${jobs.length} 条（音色 ${players.map(p => p.voice).join(' / ')}）…`);
	await fs.mkdir(cacheDir, { recursive: true });

	let cursor = 0;
	let finished = 0;
	const worker = async () => {
		while (cursor < jobs.length) {
			const job = jobs[cursor++];
			const hash = crypto.createHash('sha1').update(`${job.voice}|${job.rate}|${job.text}`).digest('hex');
			const file = path.join(cacheDir, `${hash}.mp3`);
			try {
				let buffer;
				try {
					buffer = await fs.readFile(file);
				} catch {
					buffer = await synthesize(job.text, { voice: job.voice, rate: job.rate });
					await fs.writeFile(file, buffer);
				}
				job.target.speech = `data:audio/mpeg;base64,${buffer.toString('base64')}`;
				job.target.speechText = job.text;
				finished++;
				if (finished % 10 === 0) console.log(`语音进度：${finished} / ${jobs.length}`);
			} catch (error) {
				onWarning(`语音生成失败（${job.text.slice(0, 12)}…）：${error.message}`);
			}
		}
	};

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	const done = jobs.filter(job => job.target.speech).length;
	if (done) replay.narration = { enabled: true, voices: players.map(p => p.voice) };
	console.log(`语音完成：${done} / ${jobs.length}`);
	return done;
}
