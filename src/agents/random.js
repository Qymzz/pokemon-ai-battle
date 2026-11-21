import { PRNG } from '../lib/showdown.js';

export class RandomAgent {
	constructor({ label = '随机 AI', seed } = {}) {
		this.label = label;
		this.kind = 'random';
		this.prng = PRNG.get(seed);
	}

	async chooseDraft({ options }) {
		const pick = options[this.prng.random(options.length)];
		return { species: pick.species, reason: '随机选一只', thought: '没有特别偏好，随便挑。' };
	}

	async choose({ request, sideIndex }) {
		if (!request || request.wait) return null;
		if (request.teamPreview) return { choice: 'default', reason: '随便排', thought: '随机策略，不调整队伍顺序。' };

		const pokemon = request.side.pokemon;
		if (request.forceSwitch) {
			const options = pokemon
				.map((p, i) => ({ slot: i + 1, p }))
				.filter(x => !x.p.active && !x.p.condition.endsWith('fnt'));
			if (!options.length) return { choice: 'pass', reason: '没有可换的宝可梦', thought: '没有后备可用，只能待机。' };
			const pick = options[this.prng.random(options.length)];
			return { choice: `switch ${pick.slot}`, reason: '随机换人', thought: '随机策略：闭着眼睛挑一只换上来。' };
		}

		const active = request.active?.[0];
		if (!active) return { choice: 'move 1', reason: '无可行动作', thought: '拿不到动作列表，先出一个默认招式。' };
		const usable = active.moves
			.map((m, i) => ({ slot: i + 1, ...m }))
			.filter(m => !m.disabled && m.pp !== 0);
		if (!usable.length) return { choice: 'move 1', reason: '没有可用招式', thought: '招式全部不可用，随便出。' };
		const pick = usable[this.prng.random(usable.length)];
		return { choice: `move ${pick.slot}`, reason: '随机出招', thought: '随机策略：没有计算属性克制和体力，纯看运气。' };
	}
}
