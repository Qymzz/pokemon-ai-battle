import { BattleStream, getPlayerStreams, Teams, Dex } from '../lib/showdown.js';
import { zhSpecies, zhMove, zhItem, zhAbility, spriteId } from '../lib/names.js';
import { prngSeed } from '../lib/seed.js';
import { createAgent } from '../agents/index.js';
import { HeuristicAgent } from '../agents/heuristic.js';

const FORMAT_ID = 'gen9customgame';

function monSnapshot(pokemon) {
	const species = pokemon.species;
	let types = species.types;
	try {
		types = pokemon.getTypes();
	} catch {
		// 某些状态下拿不到，用基础属性兜底
	}
	return {
		species: species.name,
		name: zhSpecies(species.name),
		sprite: spriteId(species.name),
		types,
		level: pokemon.level,
		hp: pokemon.hp,
		maxhp: pokemon.maxhp,
		status: pokemon.status || '',
		fainted: Boolean(pokemon.fainted),
		active: Boolean(pokemon.isActive),
		boosts: { ...pokemon.boosts },
	};
}

function snapshot(battle, players) {
	return {
		turn: battle.turn,
		weather: battle.field?.weather || '',
		sides: battle.sides.slice(0, 2).map((side, index) => ({
			id: side.id,
			name: players[index]?.name ?? side.name,
			active: side.active.filter(Boolean).map(monSnapshot),
			team: side.pokemon.map(monSnapshot),
		})),
	};
}

function describeChoice(choice, request) {
	if (choice === 'default') return '队伍预览：保持顺序';
	if (choice === 'pass') return '待机';
	let match = /^move (\d+)$/.exec(choice);
	if (match) {
		const move = request.active?.[0]?.moves?.[Number(match[1]) - 1];
		return move ? `使用 ${zhMove(move.move)}` : '使用招式';
	}
	match = /^switch (\d+)$/.exec(choice);
	if (match) {
		const pokemon = request.side?.pokemon?.[Number(match[1]) - 1];
		const species = pokemon?.details?.split(',')[0]?.trim();
		if (!species) return '换人';
		return `${request.forceSwitch ? '被迫换上' : '换上'} ${zhSpecies(species)}`;
	}
	return choice;
}

/** 校验 agent 给出的指令是否合法，非法就降级，绝不让战斗卡住 */
function legalChoice(choice, request, sideId) {
	const choiceText = typeof choice === 'string' ? choice.trim() : '';
	if (request.teamPreview) return choiceText === 'default' ? 'default' : 'default';

	if (request.forceSwitch) {
		const match = /^switch (\d+)$/.exec(choiceText);
		if (match) {
			const pokemon = request.side.pokemon[Number(match[1]) - 1];
			if (pokemon && !pokemon.active && !pokemon.condition.endsWith('fnt')) return choiceText;
		}
		const fallback = request.side.pokemon.findIndex((p, i) => i > 0 && !p.active && !p.condition.endsWith('fnt'));
		if (fallback > 0) return `switch ${fallback + 1}`;
		return 'pass';
	}

	const active = request.active?.[0];
	if (!active) return 'pass';

	const match = /^move (\d+)$/.exec(choiceText);
	if (match) {
		const move = active.moves[Number(match[1]) - 1];
		if (move && !move.disabled && move.pp !== 0) return choiceText;
	}
	const usable = active.moves
		.map((m, i) => ({ m, slot: i + 1 }))
		.filter(x => !x.m.disabled && x.m.pp !== 0);
	if (usable.length) return `move ${usable[0].slot}`;
	return 'move 1';
}

function teamSummary(sets) {
	return sets.map(set => ({
		species: set.species,
		name: zhSpecies(set.species),
		sprite: spriteId(set.species),
		level: set.level,
		item: zhItem(set.item),
		ability: zhAbility(set.ability),
		moves: set.moves.map(zhMove),
	}));
}

function judgeLoser(battle) {
	const score = side => {
		const alive = side.pokemon.filter(p => !p.fainted).length;
		const hp = side.pokemon.reduce((sum, p) => sum + Math.max(0, p.hp) / Math.max(1, p.maxhp), 0);
		return alive * 10 + hp;
	};
	const [p1, p2] = battle.sides;
	return score(p1) >= score(p2) ? 'p2' : 'p1';
}

/**
 * 跑一局完整战斗，返回原始协议日志、逐回合状态快照、决策记录。
 */
export async function runBattle({
	players,
	teams = null,
	formatId = FORMAT_ID,
	seed = String(Date.now()),
	maxTurns = 100,
	onWarning = () => {},
}) {
	const numericSeed = Number(seed) || (Date.now() % 1000000);
	const agents = players.map((p, i) =>
		p.agent ?? createAgent(p.kind ?? 'heuristic', { seed: prngSeed(numericSeed, 7000 + i), profile: p.profile })
	);
	const setsList = teams ?? players.map((p, i) =>
		Teams.generate('gen9randombattle', { seed: prngSeed(numericSeed, i * 137 + 1) })
	);

	const battleStream = new BattleStream();
	const streams = getPlayerStreams(battleStream);

	const log = [];
	const snapshots = new Map();
	const decisions = [];
	const downgraded = new Set();
	let finalState = null;
	let ended = false;
	let timedOut = false;

	const omniscientLoop = (async () => {
		for await (const chunk of streams.omniscient) {
			for (const line of String(chunk).split('\n')) {
				if (!line) continue;
				log.push(line);
				if (line.startsWith('|win|') || line === '|tie' || line.startsWith('|tie|')) ended = true;
			}
		}
	})();

	const sideLoops = players.map((player, index) => {
		const sideId = `p${index + 1}`;
		const agent = agents[index];
		const fallbackAgent = agent instanceof HeuristicAgent ? null : new HeuristicAgent();
		let warned = false;
		return (async () => {
			for await (const chunk of streams[sideId]) {
				for (const line of String(chunk).split('\n')) {
					if (!line.startsWith('|request|')) continue;
					const request = JSON.parse(line.slice('|request|'.length));
					if (request.wait) continue;

					const battle = battleStream.battle;
					if (battle) {
						const turn = battle.turn;
						if (turn > 0 && !snapshots.has(turn)) snapshots.set(turn, snapshot(battle, players));
						if (turn > maxTurns && !timedOut) {
							timedOut = true;
							streams.omniscient.write(`>forcelose ${judgeLoser(battle)}`);
						}
					}
					if (ended) return;

					let decision = null;
					let fallback = false;
					try {
						decision = await agent.choose({ request, battle, sideIndex: index, players });
					} catch (error) {
						if (!warned) {
							onWarning(`[${player.name}] ${error.message}，降级为启发式动作`);
							warned = true;
							downgraded.add(index);
						}
						fallback = true;
						decision = fallbackAgent ? await fallbackAgent.choose({ request, battle, sideIndex: index, players }) : null;
					}

					const choice = legalChoice(decision?.choice, request, sideId);
					decisions.push({
						turn: battle?.turn ?? 0,
						side: sideId,
						choice,
						label: describeChoice(choice, request),
						reason: decision?.reason ?? '',
						thought: decision?.thought ?? '',
						forced: Boolean(request.forceSwitch),
						inconsistent: Boolean(decision?.inconsistent),
						fallback,
					});
					streams[sideId].write(choice);
				}
			}
		})().catch(error => onWarning(`[${player.name}] 战斗流异常：${error.message}`));
	});

	streams.omniscient.write(
		`>start ${JSON.stringify({ formatid: formatId })}\n` +
		`>reseed ${prngSeed(numericSeed, 51)}\n` +
		players.map((p, i) => `>player p${i + 1} ${JSON.stringify({ name: p.name, team: Teams.pack(setsList[i]) })}`).join('\n')
	);

	await omniscientLoop;
	await Promise.all(sideLoops);

	if (battleStream.battle) finalState = snapshot(battleStream.battle, players);

	const usage = agents.reduce((acc, agent) => {
		if (!agent.usage) return acc;
		acc.calls += agent.usage.calls;
		acc.prompt_tokens += agent.usage.prompt_tokens;
		acc.completion_tokens += agent.usage.completion_tokens;
		return acc;
	}, { calls: 0, prompt_tokens: 0, completion_tokens: 0 });

	return {
		log,
		snapshots,
		decisions,
		finalState,
		timedOut,
		formatId,
		meta: {
			formatId,
			formatName: Dex.formats.get(formatId)?.name ?? '单打 6v6',
			seed,
			usage: usage.calls ? usage : null,
			players: players.map((p, i) => ({
				id: `p${i + 1}`,
				name: p.name,
				agent: agents[i].kind ?? 'heuristic',
				agentLabel: `${agents[i].label ?? 'AI'}${downgraded.has(i) ? '（已降级）' : ''}`,
				team: teamSummary(setsList[i]),
			})),
		},
	};
}
