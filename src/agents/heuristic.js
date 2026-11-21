import { Dex } from '../lib/showdown.js';
import { zhMove, zhSpecies, zhType } from '../lib/names.js';
import { typeMultiplier, pokemonTypes } from '../lib/types.js';

const HEAL_MOVES = new Set([
	'recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'morningsun',
	'synthesis', 'shoreup', 'milkdrink', 'strengthsap', 'healorder', 'lifedew',
]);
const SETUP_MOVES = new Set([
	'swordsdance', 'nastyplot', 'calmmind', 'dragondance', 'quiverdance',
	'bulkup', 'irondefense', 'agility', 'shellsmash', 'tailglow', 'coil',
	'victorydance', 'tidyup', 'clangoroussoul',
]);
const HAZARD_MOVES = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);
const STATUS_MOVES = new Set([
	'thunderwave', 'willowisp', 'toxic', 'spore', 'sleeppowder', 'hypnosis',
	'glare', 'yawn', 'nuzzle', 'poisonpowder', 'stunspore', 'confuseray',
]);
const WEATHER_MOVES = new Set(['sunnyday', 'raindance', 'sandstorm', 'snowscape', 'hail', 'electricterrain', 'grassyterrain', 'mistyterrain', 'psychicterrain']);
const FIXED_DAMAGE = new Set(['seismictoss', 'nightshade', 'counter', 'mirrorcoat', 'endeavor', 'finalgambit', 'superfang', 'ruination']);

function hpRatio(pokemon) {
	if (!pokemon || !pokemon.maxhp) return 0;
	return pokemon.hp / pokemon.maxhp;
}

function stab(moveType, attacker) {
	return pokemonTypes(attacker).includes(moveType) ? 1.5 : 1;
}

function damageScore(move, attacker, defender) {
	const data = Dex.moves.get(move.move ?? move);
	if (!data.exists) return 0;
	if (data.category === 'Status') return 0;
	const eff = typeMultiplier(data.type, pokemonTypes(defender));
	if (eff <= 0) return 0;
	const power = data.basePower || (FIXED_DAMAGE.has(data.id) ? 55 : 40);
	const accuracy = (data.accuracy === true ? 100 : data.accuracy || 100) / 100;
	let score = power * eff * stab(data.type, attacker) * (0.6 + accuracy * 0.4);
	if (data.recharge) score *= 0.75;
	if (data.selfdestruct || data.selfSwitch === 'selfdestruct') score *= hpRatio(attacker) > 0.5 ? 0.25 : 1;
	if (data.priority > 0 && hpRatio(defender) < 0.25) score += 25;
	// 对手已经免疫过这个属性时，明显该换招
	return score;
}

function statusScore(data, attacker, defender, side, foeSide, boosts) {
	const id = data.id;
	const myHp = hpRatio(attacker);
	const foeHp = hpRatio(defender);
	if (HEAL_MOVES.has(id)) return myHp < 0.5 ? 120 : 0;
	if (id === 'rest') return myHp < 0.3 && !attacker.status ? 90 : 0;
	if (SETUP_MOVES.has(id)) return myHp > 0.65 && (boosts?.atk ?? 0) < 2 && (boosts?.spa ?? 0) < 2 ? 75 : 0;
	if (HAZARD_MOVES.has(id)) {
		const hazards = Object.keys(foeSide?.sideConditions ?? {});
		return hazards.length === 0 ? 70 : 0;
	}
	if (STATUS_MOVES.has(id)) return !defender.status && foeHp > 0.3 ? 65 : 0;
	if (WEATHER_MOVES.has(id)) return 40;
	if (id === 'protect' || id === 'detect') return 25;
	if (id === 'substitute') return myHp > 0.7 ? 45 : 0;
	if (id === 'taunt' || id === 'encore') return 40;
	if (id === 'trickroom') return 35;
	return 25;
}

function benchScore(speciesName, defender) {
	const species = Dex.species.get(speciesName);
	if (!species.exists) return 0;
	const foeTypes = pokemonTypes(defender);
	const offense = Math.max(...species.types.map(t => typeMultiplier(t, foeTypes)));
	const incoming = Math.max(...foeTypes.map(t => typeMultiplier(t, species.types)));
	const defense = 1 / Math.max(0.25, incoming);
	return offense * 2 + defense;
}

function draftStrength(set) {
	const species = Dex.species.get(set.species);
	return (species.bst ?? 0) + (set.level ?? 50) * 1.5;
}

function coverageScore(set, picked) {
	const species = Dex.species.get(set.species);
	const covered = new Set(picked.flatMap(p => Dex.species.get(p.species).types));
	return species.types.filter(type => !covered.has(type)).length * 40;
}

function pickOne(list) {
	return list[Math.floor(Math.random() * list.length)];
}

function hpPercent(pokemon) {
	return Math.round(hpRatio(pokemon) * 100);
}

function nameOf(pokemon) {
	return zhSpecies(pokemon.species.name);
}

export class HeuristicAgent {
	constructor({ label = '启发式 AI' } = {}) {
		this.label = label;
		this.kind = 'heuristic';
	}

	async chooseDraft({ kind, options, picks, sideIndex }) {
		const mine = picks[`p${sideIndex + 1}`] ?? [];
		const scored = options
			.map(set => ({
				set,
				score: draftStrength(set) + (kind === 'pick' ? coverageScore(set, mine) : 0),
			}))
			.sort((a, b) => b.score - a.score);
		const best = scored[0].set;
		const species = Dex.species.get(best.species);
		const name = zhSpecies(best.species);
		const types = species.types.map(zhType).join('/');
		if (kind === 'ban') {
			return {
				species: best.species,
				reason: `${name} 综合强度最高，优先禁掉`,
				thought: `${name}（${types}）种族值 ${species.bst}，留在对面威胁最大。`,
			};
		}
		return {
			species: best.species,
			reason: `${name} 强度高且补属性`,
			thought: `${name}（${types}）种族值 ${species.bst}，能补上队伍缺的属性。`,
		};
	}

	async choose({ request, battle, sideIndex }) {
		if (!request || request.wait) return null;
		if (request.teamPreview) {
			return { choice: 'default', reason: '保持队伍顺序', thought: '队伍预览阶段不做调整，按选人顺序直接上场。' };
		}

		const mySide = battle.sides[sideIndex];
		const foeSide = battle.sides[sideIndex ^ 1];
		const me = mySide.active[0];
		const foe = foeSide.active[0];
		if (!me || !foe) {
			return { choice: request.forceSwitch ? 'pass' : 'move 1', reason: '状态异常，保守行动', thought: '暂时拿不到完整的场上信息，先做一个不会出错的保守动作。' };
		}

		if (request.forceSwitch) {
			const slot = this.pickSwitchSlot(request, foe);
			const target = slot ? request.side.pokemon[slot - 1].details.split(',')[0].trim() : null;
			return {
				choice: slot ? `switch ${slot}` : 'pass',
				reason: pickOne(['被迫换人，挑最合适的', '倒下后换人，选对位好的', '只能换上最克制的一只']),
				thought: target
					? pickOne([
						`上一只已经倒下，${zhSpecies(target)}对 ${nameOf(foe)} 的对位最好，只能先顶它上来。`,
						`场上已经空了，${zhSpecies(target)}的属性更适合接 ${nameOf(foe)}，换上它。`,
						`没得选了，${zhSpecies(target)}是后备里最能扛 ${nameOf(foe)} 的一只。`,
					])
					: '没有可换的宝可梦，只能待机。',
			};
		}

		const active = request.active?.[0];
		if (!active) return { choice: 'move 1', reason: '无可用信息' };

		const moves = active.moves.map((m, i) => ({ slot: i + 1, ...m }));
		let best = { score: -1, slot: null, label: '' };
		for (const move of moves) {
			if (move.disabled || move.pp === 0) continue;
			const data = Dex.moves.get(move.move);
			const score = data.category === 'Status'
				? statusScore(data, me, foe, mySide, foeSide, me.boosts)
				: damageScore(move, me, foe);
			if (score > best.score) best = { score, slot: move.slot, label: zhMove(move.move), move: data.id };
		}

		const bench = request.side.pokemon
			.map((p, i) => ({ slot: i + 1, p }))
			.filter(x => !x.p.active && !x.p.condition.endsWith('fnt'));
		const canSwitch = bench.length > 0 && !active.trapped;

		if (canSwitch) {
			let bestBench = { score: -1, slot: null, name: '' };
			for (const b of bench) {
				const name = b.p.details.split(',')[0].trim();
				const score = benchScore(name, foe);
				if (score > bestBench.score) bestBench = { score, slot: b.slot, name };
			}
			const danger = hpRatio(me) < 0.35 || best.score <= 0;
			if (bestBench.score > 0 && danger && bestBench.score * 8 > best.score) {
				const benchName = zhSpecies(bestBench.name);
				const myHp = hpPercent(me);
				return {
					choice: `switch ${bestBench.slot}`,
					reason: pickOne([`${nameOf(me)}血少，换${benchName}`, `对位不划算，换${benchName}`, `${benchName}更能扛`]),
					thought: pickOne([
						`${nameOf(me)}只剩 ${myHp}% 体力，再站场太亏；${benchName}对 ${nameOf(foe)} 的属性能扛一下，先换上来。`,
						`这回合不硬拼：${nameOf(me)}血量 ${myHp}%，${benchName}的对位更舒服，换人更稳。`,
						`${nameOf(me)}顶不住了，让${benchName}上来接手，至少能少吃点伤害。`,
					]),
				};
			}
		}

		if (!best.slot) {
			return { choice: 'move 1', reason: '没有可用招式', thought: '所有招式都不可用，只能随便出一个动作。' };
		}
		const hp = hpPercent(foe);
		const chosenMove = moves[best.slot - 1];
		const chosenData = Dex.moves.get(chosenMove.move);
		const eff = typeMultiplier(chosenData.type, pokemonTypes(foe));
		const foeLow = hp <= 35;
		const selfLow = hpPercent(me) <= 35;
		const plan = best.score <= 0
			? pickOne(['能用的招都不占优，先试探一下', '没有更好的选择，先出一招看看', '这回合条件不好，先稳住'])
			: foeLow
				? pickOne(['它已经残了，这一下有机会直接收掉', '残血别放跑，直接收', '血量这么低，收掉就是赚'])
				: selfLow
					? pickOne(['我自己血也不多了，只能拼这一下伤害', '血线吃紧，先打最高的伤害'])
					: pickOne(['这是目前最稳的伤害来源', '先把血量压低，后面好处理', '稳一点，先打伤害']);
		const reason = best.score <= 0
			? pickOne(['没有更优解，先试探', '先出一招看看'])
			: foeLow
				? `${best.label} ×${eff}，收残血`
				: eff >= 2
					? `${best.label} ×${eff}，效果拔群`
					: `${best.label} 打 ${hp}% 血最划算`;
		const effText = eff >= 2
			? '打上去效果拔群'
			: eff > 0 && eff < 1
				? '会被它抵抗'
				: eff === 0
					? '完全打不动'
					: '是普通倍率';
		const thought = pickOne([
			`${nameOf(foe)}还剩 ${hp}% 体力，${best.label}${effText}，${plan}。`,
			`看对面 ${nameOf(foe)} 血量 ${hp}%，${best.label}${effText}。${plan}。`,
			`${best.label}对 ${nameOf(foe)} ${effText}，对面现在 ${hp}% 血。${plan}。`,
		]);
		return { choice: `move ${best.slot}`, reason, thought };
	}

	pickSwitchSlot(request, foe) {
		const candidates = request.side.pokemon
			.map((p, i) => ({ slot: i + 1, p }))
			.filter(x => !x.p.active && !x.p.condition.endsWith('fnt'));
		let best = null;
		for (const c of candidates) {
			const name = c.p.details.split(',')[0].trim();
			const score = benchScore(name, foe);
			if (!best || score > best.score) best = { ...c, score };
		}
		return best?.slot ?? null;
	}
}
