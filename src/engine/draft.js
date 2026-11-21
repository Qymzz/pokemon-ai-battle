import fs from 'node:fs';
import { Dex, Teams, PRNG, toID } from '../lib/showdown.js';
import { zhSpecies, zhType, zhItem, zhAbility, zhMove, spriteId } from '../lib/names.js';
import { prngSeed } from '../lib/seed.js';
import { HeuristicAgent } from '../agents/heuristic.js';

const BAN_TEXT = '禁用';
const PICK_TEXT = '选择';
const LEGENDARY_TAGS = new Set(['Legendary', 'Mythical', 'Sub-Legendary']);
const popular = JSON.parse(fs.readFileSync(new URL('../data/popular.json', import.meta.url), 'utf8'));

function isLegendary(species) {
	return (species.tags || []).some(tag => LEGENDARY_TAGS.has(tag));
}

/**
 * 从高人气名单里随机抽池子：传说最多 maxLegendaries 只（0~2 随机）。
 * 名单来自 Pokémon of the Year 2020，且只保留随机对战里有配置的物种。
 */
function buildPool(baseSeed, poolSize, maxLegendaries) {
	const gen = Teams.getGenerator('gen9randombattle', prngSeed(baseSeed, 300));
	const seen = new Set();
	const candidates = [];
	for (const id of popular.species) {
		const species = Dex.species.get(id);
		if (!species?.exists || seen.has(species.id) || !gen.randomSets?.[species.id]) continue;
		seen.add(species.id);
		candidates.push(species);
	}

	const rng = PRNG.get(prngSeed(baseSeed, 301));
	const shuffle = list => {
		const copy = [...list];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = rng.random(i + 1);
			[copy[i], copy[j]] = [copy[j], copy[i]];
		}
		return copy;
	};

	const legendaries = candidates.filter(isLegendary);
	const normals = candidates.filter(species => !isLegendary(species));
	// PRNG.random(m, n) 的区间是 [m, n)，所以这里传 maxLegendaries + 1
	const legendCount = Math.min(legendaries.length, rng.random(maxLegendaries + 1));
	const ordered = [
		...shuffle(legendaries).slice(0, legendCount),
		...shuffle(normals),
	];

	const sets = [];
	for (const species of ordered) {
		if (sets.length >= poolSize) break;
		try {
			const set = gen.randomSet(species.id, {}, false, false);
			if (set) sets.push(set);
		} catch {
			// 个别物种没有可用配置，跳过即可
		}
	}
	return { sets, legendCount };
}

/** 禁用阶段：p1、p2 交替各禁 */
function banSequence(bansPerSide) {
	const order = [];
	for (let i = 0; i < bansPerSide; i++) order.push('p1', 'p2');
	return order;
}

/** 选人阶段：蛇形，保证先后手公平 */
function draftSequence(teamSize) {
	const order = [];
	for (let round = 0; round < teamSize; round++) {
		order.push(...(round % 2 === 0 ? ['p1', 'p2'] : ['p2', 'p1']));
	}
	return order;
}

function poolEntry(set) {
	const species = Dex.species.get(set.species);
	return {
		species: set.species,
		name: zhSpecies(set.species),
		sprite: spriteId(set.species),
		level: set.level,
		types: species.types,
		typesZh: species.types.map(zhType),
		item: zhItem(set.item),
		ability: zhAbility(set.ability),
		moves: set.moves.map(zhMove),
	};
}

function normalizeSpecies(value, options) {
	const id = toID(String(value ?? ''));
	const target = options.find(set => toID(set.species) === id);
	return target ? target.species : null;
}

/**
 * 跑完整的 BP：共用英雄池 -> 各禁 bansPerSide 只 -> 蛇形选 teamSize 只。
 * 每个动作都会记录选择与理由，供回放展示。
 */
export async function runDraft({
	players,
	seed,
	poolSize = 18,
	bansPerSide = 2,
	teamSize = 6,
	maxLegendaries = 2,
	onWarning = () => {},
}) {
	const baseSeed = Number(seed) || (Date.now() % 1000000);
	const { sets: poolSets, legendCount } = buildPool(baseSeed, poolSize, maxLegendaries);
	const taken = new Set();
	const bans = { p1: [], p2: [] };
	const picks = { p1: [], p2: [] };
	const actions = [];

	const available = () => poolSets.filter(set => !taken.has(set.species));

	const steps = [
		...banSequence(bansPerSide).map(side => ({ side, kind: 'ban' })),
		...draftSequence(teamSize).map(side => ({ side, kind: 'pick' })),
	];

	for (const step of steps) {
		const sideIndex = Number(step.side.slice(1)) - 1;
		const options = available();
		if (!options.length) break;
		const agent = players[sideIndex].agent;

		let chosen = null;
		let reason = '';
		let thought = '';
		let fallback = false;
		try {
			const answer = await agent.chooseDraft({
				kind: step.kind,
				sideIndex,
				options,
				bans,
				picks,
				teamSize,
				bansPerSide,
				players,
			});
			chosen = normalizeSpecies(answer?.species, options);
			reason = typeof answer?.reason === 'string' ? answer.reason.slice(0, 60) : '';
			thought = typeof answer?.thought === 'string' ? answer.thought.slice(0, 200) : '';
			if (!chosen) throw new Error('给出的宝可梦不在候选池里');
		} catch (error) {
			fallback = true;
			onWarning(`[${players[sideIndex].name}] BP 决策降级：${error.message}`);
			const fallbackAnswer = await new HeuristicAgent()
				.chooseDraft({ kind: step.kind, sideIndex, options, bans, picks, teamSize, bansPerSide, players });
			chosen = normalizeSpecies(fallbackAnswer?.species, options) ?? options[0].species;
			reason = fallbackAnswer?.reason ?? '';
			thought = fallbackAnswer?.thought ?? '';
		}

		const set = options.find(item => item.species === chosen) ?? options[0];
		taken.add(set.species);
		if (step.kind === 'ban') bans[step.side].push(set.species);
		else picks[step.side].push(set.species);

		const entry = poolEntry(set);
		actions.push({
			side: step.side,
			kind: step.kind,
			species: set.species,
			name: entry.name,
			sprite: entry.sprite,
			level: entry.level,
			types: entry.types,
			typesZh: entry.typesZh,
			reason,
			thought,
			fallback,
			label: `${step.kind === 'ban' ? BAN_TEXT : PICK_TEXT} ${entry.name}`,
		});
	}

	const bySpecies = new Map(poolSets.map(set => [set.species, set]));

	return {
		pool: poolSets.map(poolEntry),
		actions,
		bans,
		picks,
		teams: {
			p1: picks.p1.map(species => bySpecies.get(species)).filter(Boolean),
			p2: picks.p2.map(species => bySpecies.get(species)).filter(Boolean),
		},
		poolSize,
		bansPerSide,
		teamSize,
		poolMeta: {
			source: 'popular',
			legendCount,
			maxLegendaries,
			candidates: popular.count,
		},
	};
}
