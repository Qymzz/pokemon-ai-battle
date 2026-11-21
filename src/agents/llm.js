import { Dex } from '../lib/showdown.js';
import { zhSpecies, zhMove, zhType, zhItem, zhAbility } from '../lib/names.js';
import { typeMultiplier, pokemonTypes } from '../lib/types.js';
import { loadLlmConfig, isConfigured } from '../config.js';

const STATUS_ZH = { brn: '灼伤', par: '麻痹', slp: '睡眠', psn: '中毒', tox: '剧毒', frz: '冰冻' };
const STAT_ZH = {
	atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度', accuracy: '命中', evasion: '闪避',
};
const WEATHER_ZH = {
	raindance: '下雨', primordialsea: '大雨', sandstorm: '沙暴', snowscape: '下雪',
	hail: '冰雹', sunnyday: '日照', desolateland: '强烈日照', deltastream: '乱流',
};
const SIDE_CONDITION_ZH = {
	stealthrock: '隐形岩', spikes: '撒菱', toxicspikes: '毒菱', stickyweb: '黏黏网',
	reflect: '反射壁', lightscreen: '光墙', auroraveil: '极光幕', tailwind: '顺风',
	safeguard: '神秘守护', mist: '白雾',
};

const SYSTEM_PROMPT = [
	'你是一名宝可梦对战选手，正在进行第 9 世代单打 6v6 对战。',
	'目标：从给定的合法动作里选择本回合收益最高的一步，最终击倒对手全部宝可梦。',
	'规则要点：',
	'- 每回合双方各选一个动作，速度快的先出手（优先度招式例外）。',
	'- 换人消耗本回合行动，换上的宝可梦会立刻承受对手攻击。',
	'- 动作列表里已经标注属性倍率：×2 效果拔群，×0.5 效果不佳，×0 完全无效。',
	'- 异常状态、能力变化、天气、场地效果都会影响后续回合。',
	'只输出一个 JSON 对象，不要 markdown，不要多余解释。',
	'thought 必须解释你这次实际选择的动作，不要描述你下回合打算做什么。',
	'reason 和 thought 不要重复同一句话；thought 用自然口语，像选手在自言自语，避免每回合套用同一句式。',
	'招式：{"action":"move","index":1,"reason":"20字内结论","thought":"1~2句话解释你的判断"}',
	'换人：{"action":"switch","index":3,"reason":"20字内结论","thought":"1~2句话解释你的判断"}',
].join('\n');

const DRAFT_SYSTEM_PROMPT = [
	'你是宝可梦 6v6 单打 BP 阶段的选手。',
	'禁用阶段：优先移除对你有威胁、对手会抢的宝可梦。',
	'选人阶段：兼顾强度、属性覆盖和队伍平衡，不要重复堆同一种属性。',
	'只能从候选列表里按序号选择。',
	'只输出一个 JSON 对象，不要 markdown，不要多余解释。',
	'格式：{"index":3,"reason":"20字内结论","thought":"1~2句话解释"}',
].join('\n');

function percent(mon) {
	return mon.maxhp ? Math.round((mon.hp / mon.maxhp) * 100) : 0;
}

function boostText(mon) {
	const parts = Object.entries(mon.boosts || {})
		.filter(([, value]) => value)
		.map(([stat, value]) => `${STAT_ZH[stat] ?? stat}${value > 0 ? '+' : ''}${value}`);
	return parts.length ? ` 能力变化：${parts.join('、')}` : '';
}

function describeMon(mon) {
	const types = pokemonTypes(mon).map(zhType).join('/');
	const status = mon.status ? `，${STATUS_ZH[mon.status] ?? mon.status}` : '';
	return `${zhSpecies(mon.species.name)}（${types}）Lv.${mon.level} 体力 ${Math.max(0, mon.hp)}/${mon.maxhp}（${percent(mon)}%）${status}${boostText(mon)}`;
}

function sideConditionText(side) {
	const names = Object.keys(side.sideConditions || {}).map(id => SIDE_CONDITION_ZH[id] ?? id);
	return names.length ? names.join('、') : '无';
}

function buildPrompt({ request, battle, sideIndex, playerName }) {
	const mySide = battle.sides[sideIndex];
	const foeSide = battle.sides[sideIndex ^ 1];
	const me = mySide.active[0];
	const foe = foeSide.active[0];
	const lines = [];

	lines.push(`【回合 ${battle.turn}】`);
	lines.push(`天气：${WEATHER_ZH[battle.field.weather] ?? (battle.field.weather || '无')}`);
	lines.push(`我方场地：${sideConditionText(mySide)}；对方场地：${sideConditionText(foeSide)}`);
	lines.push('');
	lines.push(`我方（${playerName}）场上：${me ? describeMon(me) : '无'}`);
	const bench = mySide.pokemon.filter(p => !p.isActive && !p.fainted);
	lines.push(`我方后备：${bench.length ? bench.map(p => zhSpecies(p.species.name)).join('、') : '无'}`);
	lines.push(`对手场上：${foe ? describeMon(foe) : '无'}`);
	lines.push(`对手后备：${foeSide.pokemon.filter(p => !p.isActive && !p.fainted).map(p => zhSpecies(p.species.name)).join('、') || '无'}`);
	lines.push('');

	if (request.forceSwitch) {
		lines.push('当前必须换上一只后备宝可梦，可选动作：');
		const options = request.side.pokemon
			.map((p, i) => ({ p, slot: i + 1 }))
			.filter(x => !x.p.active && !x.p.condition.endsWith('fnt'));
		for (const { p, slot } of options) {
			const species = p.details.split(',')[0].trim();
			const hp = p.condition.split(' ')[0];
			lines.push(`  ${slot}. ${zhSpecies(species)}（体力 ${hp}）`);
		}
		lines.push('只输出 switch 动作。');
		return lines.join('\n');
	}

	const active = request.active?.[0];
	lines.push('可选招式：');
	for (const [i, move] of (active?.moves || []).entries()) {
		const data = Dex.moves.get(move.move);
		const disabled = move.disabled || move.pp === 0 ? '（不可用）' : '';
		const eff = foe ? typeMultiplier(data.type, pokemonTypes(foe)) : 1;
		const power = data.category === 'Status' ? '变化' : `威力 ${data.basePower || '—'}`;
		lines.push(`  ${i + 1}. ${zhMove(move.move)}（${zhType(data.type)} / ${data.category === 'Status' ? '变化' : data.category === 'Physical' ? '物理' : '特殊'} / ${power} / PP ${move.pp}/${move.maxpp} / 对当前对手 ×${eff}）${disabled}`);
	}
	if (!active?.trapped && bench.length) {
		lines.push('可选换人：');
		for (const [i, pokemon] of request.side.pokemon.entries()) {
			if (pokemon.active || pokemon.condition.endsWith('fnt')) continue;
			const species = pokemon.details.split(',')[0].trim();
			const hp = pokemon.condition.split(' ')[0];
			lines.push(`  ${i + 1}. 换上 ${zhSpecies(species)}（体力 ${hp}）`);
		}
	} else {
		lines.push('当前无法换人。');
	}
	lines.push('');
	lines.push('请只输出 JSON。');
	return lines.join('\n');
}

function buildDraftPrompt({ kind, options, picks, bans, sideIndex, teamSize }) {
	const me = `p${sideIndex + 1}`;
	const foe = `p${(sideIndex ^ 1) + 1}`;
	const lines = [];
	lines.push(`阶段：${kind === 'ban' ? '禁用（这只双方都不能再用）' : '选人（加入你的队伍）'}`);
	lines.push(`我方已选：${picks[me].map(zhSpecies).join('、') || '无'}`);
	lines.push(`对手已选：${picks[foe].map(zhSpecies).join('、') || '无'}`);
	lines.push(`已禁用：${[...bans.p1, ...bans.p2].map(zhSpecies).join('、') || '无'}`);
	if (kind === 'pick') lines.push(`你还需要选 ${Math.max(0, teamSize - picks[me].length)} 只`);
	lines.push('');
	lines.push('候选：');
	options.forEach((set, i) => {
		const species = Dex.species.get(set.species);
		lines.push(
			`  ${i + 1}. ${zhSpecies(set.species)}（${species.types.map(zhType).join('/')}）` +
			`Lv.${set.level} 道具：${zhItem(set.item)} 特性：${zhAbility(set.ability)} ` +
			`招式：${set.moves.map(zhMove).join('、')}`
		);
	});
	lines.push('');
	lines.push('只输出 JSON：{"index":序号,"reason":"20字内结论","thought":"1~2句解释"}');
	return lines.join('\n');
}

function extractJson(text) {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error(`LLM 输出不是 JSON：${String(text).slice(0, 80)}`);
	return JSON.parse(text.slice(start, end + 1));
}

function normalizeAnswer(answer, request) {
	const rawAction = String(answer?.action ?? answer?.type ?? '').toLowerCase();
	const index = Number(answer?.index ?? answer?.move ?? answer?.switch ?? answer?.slot);
	if (!Number.isInteger(index)) throw new Error('LLM 输出缺少合法的 index');

	// 各厂商/模型措辞不一：switch / swap / 换人 都当换人处理
	const wantsSwitch = rawAction.includes('switch') || rawAction.includes('swap') || rawAction.includes('换');
	const benchSlot = request.side.pokemon[index - 1];
	const isValidBench = benchSlot && !benchSlot.active && !benchSlot.condition.endsWith('fnt');

	if (request.forceSwitch) {
		if (!isValidBench) throw new Error(`LLM 选择了非法换人槽位：${index}`);
		return `switch ${index}`;
	}

	if (wantsSwitch || (!rawAction.includes('move') && index > 4 && isValidBench)) {
		if (!isValidBench) throw new Error(`LLM 选择了非法换人槽位：${index}`);
		return `switch ${index}`;
	}

	const move = request.active?.[0]?.moves?.[index - 1];
	if (!move || move.disabled || move.pp === 0) {
		throw new Error(`LLM 选择了非法招式槽位：${index}`);
	}
	return `move ${index}`;
}

/** DeepSeek / 豆包 等 OpenAI 兼容服务的决策代理 */
export class LlmAgent {
	constructor({ label, profile, config } = {}) {
		this.profile = profile;
		this.config = config ?? loadLlmConfig(profile);
		this.kind = 'llm';
		this.label = label ?? this.config.label ?? this.config.model ?? profile ?? 'LLM';
		this.configured = isConfigured(this.config);
		this.voice = this.config.tts?.voice;
		this.voiceRate = this.config.tts?.rate;
		this.usage = { calls: 0, prompt_tokens: 0, completion_tokens: 0 };
	}

	async choose({ request, battle, sideIndex, players }) {
		if (!request || request.wait) return null;
		if (request.teamPreview) return { choice: 'default', reason: '沿用队伍顺序' };
		if (!this.configured) {
			throw new Error(
				`LLM 未配置${this.profile ? `（${this.profile}）` : ''}：` +
				'请在 config/llm.local.json 里填写 baseUrl / apiKey / model'
			);
		}

		const playerName = players?.[sideIndex]?.name ?? '我方';
		const prompt = buildPrompt({ request, battle, sideIndex, playerName });

		let content = await this.ask(prompt);
		if (process.env.POKE_LLM_DEBUG) console.log(`[${this.label}] ${content}`);
		let answer;
		try {
			answer = extractJson(content);
		} catch (error) {
			// 兜底再问一次，明确提醒只能输出 JSON
			content = await this.ask(`${prompt}\n\n上一次输出无法解析。请只输出 JSON 对象，不要任何其他文字。`);
			answer = extractJson(content);
		}

		const choice = normalizeAnswer(answer, request);
		const reason = typeof answer.reason === 'string' ? answer.reason.slice(0, 40) : '';
		const thought = typeof answer.thought === 'string' ? answer.thought.slice(0, 200) : '';
		// 出招却把理由写成换人：模型偶尔会写岔，单独标记出来，避免观众误读
		const inconsistent = choice.startsWith('move') && /换|替补|派上/.test(reason);
		return { choice, reason: reason || '模型没有给出理由', thought, inconsistent };
	}

	async chooseDraft({ kind, options, picks, bans, sideIndex, teamSize }) {
		if (!this.configured) {
			throw new Error(
				`LLM 未配置${this.profile ? `（${this.profile}）` : ''}：` +
				'请在 config/llm.local.json 里填写 baseUrl / apiKey / model'
			);
		}

		const prompt = buildDraftPrompt({ kind, options, picks, bans, sideIndex, teamSize });
		let content = await this.ask(prompt, DRAFT_SYSTEM_PROMPT);
		if (process.env.POKE_LLM_DEBUG) console.log(`[${this.label}] BP ${content}`);

		let answer;
		try {
			answer = extractJson(content);
		} catch {
			content = await this.ask(`${prompt}\n\n上一次输出无法解析。请只输出 JSON 对象。`, DRAFT_SYSTEM_PROMPT);
			answer = extractJson(content);
		}

		const index = Number(answer.index);
		if (!Number.isInteger(index) || index < 1 || index > options.length) {
			throw new Error(`BP 输出的序号非法：${answer.index}`);
		}
		return {
			species: options[index - 1].species,
			reason: typeof answer.reason === 'string' ? answer.reason.slice(0, 60) : '',
			thought: typeof answer.thought === 'string' ? answer.thought.slice(0, 200) : '',
		};
	}

	async ask(userPrompt, systemPrompt = SYSTEM_PROMPT) {
		const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
		let jsonMode = this.config.jsonMode !== false;
		let lastError;

		for (let attempt = 1; attempt <= 2; attempt++) {
			const body = {
				model: this.config.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				temperature: this.config.temperature ?? 0.4,
				max_tokens: this.config.maxTokens ?? 200,
			};
			if (jsonMode) body.response_format = { type: 'json_object' };
			// 火山方舟的推理模型可以关闭思考链路，把单步耗时从十几秒压到两秒内
			if (this.config.thinking === 'disabled') body.thinking = { type: 'disabled' };

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);
			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${this.config.apiKey}`,
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});
				if (!response.ok) {
					const text = await response.text();
					// 某些厂商不支持 json_object，去掉该参数重试一次
					if (jsonMode && response.status === 400 && /response_format|json_object/i.test(text)) {
						jsonMode = false;
						attempt -= 1;
						continue;
					}
					throw new Error(`HTTP ${response.status}：${text.slice(0, 120)}`);
				}
				const data = await response.json();
				this.usage.calls += 1;
				this.usage.prompt_tokens += data.usage?.prompt_tokens ?? 0;
				this.usage.completion_tokens += data.usage?.completion_tokens ?? 0;
				return data.choices?.[0]?.message?.content ?? '';
			} catch (error) {
				lastError = error;
			} finally {
				clearTimeout(timer);
			}
		}
		throw new Error(`LLM 调用失败：${lastError?.message ?? '未知错误'}`);
	}
}
