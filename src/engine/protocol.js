import { Dex } from '../lib/showdown.js';
import { zhSpecies, zhMove, zhItem, zhAbility, zhType, spriteId } from '../lib/names.js';

const STATUS_ZH = {
	brn: '灼伤', par: '麻痹', slp: '睡眠', psn: '中毒', tox: '剧毒', frz: '冰冻', fnt: '濒死',
};

const STAT_ZH = {
	atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度',
	accuracy: '命中率', evasion: '闪避率',
};

const WEATHER_ZH = {
	raindance: '下雨', primordialsea: '大雨', sandstorm: '沙暴', snowscape: '下雪',
	hail: '冰雹', sunnyday: '日照', desolateland: '强烈日照', deltastream: '乱流',
};

const CONDITION_ZH = {
	confusion: '混乱', substitute: '替身', leechseed: '寄生种子', flinch: '畏缩',
	taunt: '挑衅', encore: '再来一次', disable: '定身法', yawn: '哈欠',
	focusenergy: '聚气', aquaring: '水环', ingrain: '扎根', attract: '着迷',
	curse: '诅咒', nightmare: '恶梦', torment: '无理取闹', healblock: '回复封锁',
	trickroom: '戏法空间', gravity: '重力', magicalroom: '魔法空间', wonderroom: '奇妙空间',
	electricterrain: '电气场地', grassyterrain: '青草场地', mistyterrain: '薄雾场地', psychicterrain: '精神场地',
	stealthrock: '隐形岩', spikes: '撒菱', toxicspikes: '毒菱', stickyweb: '黏黏网',
	lightscreen: '光墙', reflect: '反射壁', auroraveil: '极光幕', tailwind: '顺风',
	safeguard: '神秘守护', mist: '白雾',
};

/** 把 `move: X` / `ability: X` / `item: X` 这类 effect 描述翻成中文 */
function effectName(raw) {
	if (!raw) return '';
	const match = /^(move|ability|item|condition): (.*)$/.exec(raw);
	if (match) {
		const [, kind, name] = match;
		if (kind === 'move') return zhMove(name);
		if (kind === 'ability') return zhAbility(name);
		if (kind === 'item') return zhItem(name);
		return CONDITION_ZH[name.toLowerCase()] ?? zhMove(name);
	}
	const id = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
	return CONDITION_ZH[id] ?? WEATHER_ZH[id] ?? zhMove(raw);
}

function parseSlot(slot) {
	if (!slot) return null;
	const [position, nickname] = slot.split(': ');
	const side = position.slice(0, 2);
	return { key: position, side, nickname: nickname ?? '' };
}

function parseHp(rawHp) {
	if (!rawHp) return null;
	const match = /^(\d+)\/(\d+)/.exec(rawHp);
	if (match) return { hp: Number(match[1]), maxhp: Number(match[2]) };
	if (/^0 fnt/.test(rawHp)) return { hp: 0, maxhp: 0, fainted: true };
	return null;
}

function percent(hp, maxhp) {
	if (!maxhp) return 0;
	return Math.max(0, Math.min(100, Math.round((hp / maxhp) * 100)));
}

function createTranslator(meta) {
	const slots = {};
	const hp = {};

	const display = slotKey => {
		const species = slots[slotKey];
		if (species) return zhSpecies(species);
		return slotKey;
	};

	const sideName = sideId => meta.players.find(p => p.id === sideId)?.name ?? sideId;

	return {
		slots,
		hp,
		display,
		sideName,
		rememberSlot(slotKey, species) {
			if (species) slots[slotKey] = species;
		},
		rememberHp(slotKey, value) {
			if (value) hp[slotKey] = value;
		},
	};
}

function sourceLabel(raw) {
	if (!raw) return '';
	const first = String(raw).split('|').find(Boolean) ?? '';
	const cleaned = first.replace(/\[from\]\s*/, '').trim();
	const match = /^(item|ability|move):\s*(.+)$/.exec(cleaned);
	if (match) {
		const [, kind, name] = match;
		if (kind === 'item') return zhItem(name);
		if (kind === 'ability') return zhAbility(name);
		return zhMove(name);
	}
	const fixed = {
		psn: '中毒', tox: '剧毒', brn: '灼伤', sandstorm: '沙暴', hail: '冰雹',
		snowscape: '下雪', recoil: '反作用力', drain: '吸取', leechseed: '寄生种子',
	};
	return fixed[cleaned.toLowerCase()] ?? effectName(cleaned);
}

function lineToEntries(line, tr) {
	const parts = line.slice(1).split('|');
	const cmd = parts[0];
	const rest = parts.slice(1);

	switch (cmd) {
		case 'move': {
			const actor = parseSlot(rest[0]);
			const move = rest[1];
			const data = Dex.moves.get(move);
			const target = parseSlot(rest[2]);
			return [{
				kind: 'move',
				side: actor?.side ?? null,
				targetSide: target?.side ?? null,
				moveType: data?.exists ? data.type : null,
				moveCategory: data?.exists ? data.category : null,
				text: `${tr.display(actor?.key)} 使用了 ${zhMove(move)}！`,
			}];
		}
		case 'switch':
		case 'drag': {
			const info = parseSlot(rest[0]);
			const species = rest[1]?.split(',')[0]?.trim();
			const value = parseHp(rest[2]);
			tr.rememberSlot(info?.key, species);
			tr.rememberHp(info?.key, value);
			return [{
				kind: 'switch',
				side: info?.side ?? null,
				text: `${zhSpecies(species)} ${cmd === 'drag' ? '被拖上场了' : '上场了'}！`,
				hp: value,
			}];
		}
		case 'faint': {
			const info = parseSlot(rest[0]);
			const current = tr.hp[info?.key];
			if (current) current.hp = 0;
			return [{
				kind: 'faint',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 倒下了！`,
			}];
		}
		case '-damage':
		case '-sethp': {
			const info = parseSlot(rest[0]);
			const value = parseHp(rest[1]);
			const previous = tr.hp[info?.key];
			if (value && !value.maxhp) value.maxhp = previous?.maxhp ?? 0;
			const delta = previous && value ? Math.max(0, previous.hp - value.hp) : null;
			tr.rememberHp(info?.key, value);
			const fromRaw = rest.slice(2).join('|');
			const source = fromRaw.includes('[from]') ? sourceLabel(fromRaw) : '';
			const pct = value ? percent(value.hp, value.maxhp) : null;
			const text = delta !== null && delta > 0
				? `${tr.display(info?.key)} 损失了 ${delta} 点体力（剩 ${pct}%）${source ? ` · ${source}` : ''}`
				: `${tr.display(info?.key)} 的体力降低了（剩 ${pct}%）${source ? ` · ${source}` : ''}`;
			return [{ kind: 'damage', side: info?.side ?? null, text, hp: value, delta }];
		}
		case '-heal': {
			const info = parseSlot(rest[0]);
			const value = parseHp(rest[1]);
			const previous = tr.hp[info?.key];
			const delta = previous && value ? Math.max(0, value.hp - previous.hp) : null;
			tr.rememberHp(info?.key, value);
			const pct = value ? percent(value.hp, value.maxhp) : null;
			const fromRaw = rest.slice(2).join('|');
			const source = fromRaw.includes('[from]') ? sourceLabel(fromRaw) : '';
			const text = delta !== null
				? `${tr.display(info?.key)} 恢复了 ${delta} 点体力（${pct}%）${source ? ` · ${source}` : ''}`
				: `${tr.display(info?.key)} 恢复了体力（${pct}%）`;
			return [{ kind: 'heal', side: info?.side ?? null, text, hp: value }];
		}
		case '-status': {
			const info = parseSlot(rest[0]);
			const status = rest[1];
			return [{
				kind: 'status',
				side: info?.side ?? null,
				status,
				text: `${tr.display(info?.key)} 陷入了${STATUS_ZH[status] ?? status}状态`,
			}];
		}
		case '-curestatus': {
			const info = parseSlot(rest[0]);
			const status = rest[1];
			return [{
				kind: 'heal',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的${STATUS_ZH[status] ?? status}状态解除了`,
			}];
		}
		case '-cureteam': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'heal',
				side: info?.side ?? null,
				text: `${tr.sideName(info?.side)} 的队伍全部恢复了状态`,
			}];
		}
		case '-boost':
		case '-unboost': {
			const info = parseSlot(rest[0]);
			const stat = STAT_ZH[rest[1]] ?? rest[1];
			const amount = Math.abs(Number(rest[2]) || 1);
			const up = cmd === '-boost';
			return [{
				kind: up ? 'buff' : 'debuff',
				side: info?.side ?? null,
				stat: rest[1],
				amount,
				text: `${tr.display(info?.key)} 的${stat}${up ? '提升' : '下降'}了 ${amount} 级`,
			}];
		}
		case '-setboost': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'buff',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的${STAT_ZH[rest[1]] ?? rest[1]}变为 ${rest[2]} 级`,
			}];
		}
		case '-clearboost': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'debuff', side: info?.side ?? null, text: `${tr.display(info?.key)} 的能力变化被清除了` }];
		}
		case '-clearallboost':
			return [{ kind: 'debuff', side: null, text: '双方的能力变化全部被清除了' }];
		case '-invertboost': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'debuff', side: info?.side ?? null, text: `${tr.display(info?.key)} 的能力变化被逆转了` }];
		}
		case '-swapboost': {
			const a = parseSlot(rest[0]);
			const b = parseSlot(rest[1]);
			return [{ kind: 'buff', side: a?.side ?? null, text: `${tr.display(a?.key)} 与 ${tr.display(b?.key)} 交换了能力变化` }];
		}
		case '-copyboost': {
			const a = parseSlot(rest[0]);
			const b = parseSlot(rest[1]);
			return [{ kind: 'buff', side: a?.side ?? null, text: `${tr.display(a?.key)} 复制了 ${tr.display(b?.key)} 的能力变化` }];
		}
		case '-crit': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'crit', side: info?.side ?? null, text: '会心一击！' }];
		}
		case '-supereffective': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'effect', effect: 'super', side: info?.side ?? null, text: '效果拔群！' }];
		}
		case '-resisted': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'effect', effect: 'resist', side: info?.side ?? null, text: '效果不佳…' }];
		}
		case '-immune': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'effect', effect: 'immune', side: info?.side ?? null, text: `${tr.display(info?.key)} 完全没有受到影响` }];
		}
		case '-miss': {
			const attacker = parseSlot(rest[0]);
			const target = parseSlot(rest[1]);
			return [{
				kind: 'miss',
				side: attacker?.side ?? null,
				targetSide: target?.side ?? null,
				text: '攻击落空了！',
			}];
		}
		case '-fail': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'info', side: info?.side ?? null, text: `${tr.display(info?.key)} 的招式没有生效…` }];
		}
		case '-ability': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的特性「${zhAbility(rest[1])}」发动了！`,
			}];
		}
		case '-endability': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'system', side: info?.side ?? null, text: `${tr.display(info?.key)} 的特性被无效化了` }];
		}
		case '-item': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的「${zhItem(rest[1])}」发动了`,
			}];
		}
		case '-enditem': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的「${zhItem(rest[1])}」被消耗了`,
			}];
		}
		case '-weather': {
			const weather = rest[0];
			return [{
				kind: 'system',
				side: null,
				weather: weather && weather !== 'none' ? weather : null,
				text: weather && weather !== 'none'
					? `天气变成了${WEATHER_ZH[weather] ?? effectName(weather)}`
					: '天气恢复了正常',
			}];
		}
		case '-fieldstart': return [{ kind: 'system', side: null, text: `${effectName(rest[0])} 展开了！` }];
		case '-fieldend': return [{ kind: 'system', side: null, text: `${effectName(rest[0])} 结束了` }];
		case '-sidestart': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.sideName(info?.side)} 的场地上出现了${effectName(rest[1])}`,
			}];
		}
		case '-sideend': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.sideName(info?.side)} 场地上的${effectName(rest[1])}消失了`,
			}];
		}
		case '-start':
		case '-singleturn':
		case '-singlemove':
		case '-activate': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的${effectName(rest[1])}发动了`,
			}];
		}
		case '-end': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 的${effectName(rest[1])}结束了`,
			}];
		}
		case '-prepare': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'move',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 正在蓄力${zhMove(rest[1])}…`,
			}];
		}
		case '-mustrecharge': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'info',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 需要重新蓄力`,
			}];
		}
		case '-cant': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'info',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 无法行动（${effectName(rest[2] ?? rest[1])}）`,
			}];
		}
		case '-ohko': return [{ kind: 'crit', side: null, text: '一击必杀！' }];
		case '-mega': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 进行了 Mega 进化！`,
			}];
		}
		case '-terastallize': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 太晶化成了${zhType(rest[1])}属性！`,
			}];
		}
		case '-formechange': {
			const info = parseSlot(rest[0]);
			return [{
				kind: 'system',
				side: info?.side ?? null,
				text: `${tr.display(info?.key)} 变成了 ${zhSpecies(rest[1])}`,
			}];
		}
		case '-transform': {
			const info = parseSlot(rest[0]);
			return [{ kind: 'system', side: info?.side ?? null, text: `${tr.display(info?.key)} 变身了！` }];
		}
		case '-message': return [{ kind: 'info', side: null, text: rest[0] }];
		case 'error': return [{ kind: 'info', side: null, text: `引擎提示：${rest[0]}` }];
		case 'win': return [{ kind: 'win', side: null, text: `${rest[0]} 获胜！` }];
		case 'tie': return [{ kind: 'win', side: null, text: '双双失去战斗能力，平局！' }];
		default:
			return [];
	}
}

const SKIP_PREFIXES = [
	'|t:', '|debug|', '|c|', '|c:', '|raw|', '|html|', '|uhtml', '|gametype|',
	'|player|', '|gen|', '|tier|', '|clearpoke', '|poke|', '|teamsize|', '|upkeep',
	'|rule|', '|rated', '|start', '|teampreview', '|hint|', '|bigerror|',
];

/**
 * 把 Showdown 原始协议日志整理成「回合 beat」序列，附带每回合的前后状态快照。
 */
export function buildReplay({ log, snapshots, decisions, finalState, timedOut, meta }) {
	const translator = createTranslator(meta);
	const beats = [];
	let current = { kind: 'lead', turn: 0, entries: [] };

	const flush = () => {
		if (current.entries.length || current.kind !== 'lead') beats.push(current);
	};

	for (const line of log) {
		if (line.startsWith('|turn|')) {
			flush();
			current = { kind: 'turn', turn: Number(line.slice(6)), entries: [] };
			continue;
		}
		if (line.startsWith('|win|') || line === '|tie') {
			flush();
			current = { kind: 'result', turn: null, entries: [] };
		}
		if (SKIP_PREFIXES.some(prefix => line.startsWith(prefix))) continue;
		if (!line.startsWith('|')) continue;
		const entries = lineToEntries(line, translator);
		if (entries.length) current.entries.push(...entries);
	}
	flush();

	for (const beat of beats) {
		if (beat.kind === 'turn') {
			beat.before = snapshots.get(beat.turn) ?? null;
			beat.after = snapshots.get(beat.turn + 1) ?? finalState ?? null;
			beat.decisions = decisions.filter(d => d.turn === beat.turn);
		} else if (beat.kind === 'lead') {
			beat.before = null;
			beat.after = snapshots.get(1) ?? finalState ?? null;
			beat.decisions = decisions.filter(d => d.turn === 0 && d.choice === 'default');
		} else {
			beat.before = finalState ?? null;
			beat.after = finalState ?? null;
			beat.decisions = [];
		}
	}

	const winLine = log.find(line => line.startsWith('|win|'));
	const winnerName = winLine ? winLine.slice(5) : null;
	const winner = meta.players.find(p => p.name === winnerName) ?? null;
	const turns = log.filter(line => line.startsWith('|turn|')).length;

	return {
		meta: {
			...meta,
			generatedAt: new Date().toISOString(),
		},
		result: {
			winner: winner?.id ?? null,
			winnerName: winner?.name ?? winnerName ?? '平局',
			turns,
			timedOut,
		},
		beats,
	};
}

export { spriteId };
