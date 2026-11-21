import { RandomAgent } from './random.js';
import { HeuristicAgent } from './heuristic.js';
import { LlmAgent } from './llm.js';

export function createAgent(kind = 'heuristic', options = {}) {
	switch (kind) {
		case 'random':
			return new RandomAgent(options);
		case 'heuristic':
			return new HeuristicAgent(options);
		case 'llm':
			return new LlmAgent(options);
		default:
			throw new Error(`未知的 agent 类型：${kind}（可选 random / heuristic / llm）`);
	}
}
