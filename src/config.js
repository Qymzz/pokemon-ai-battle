import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(here, '../config/llm.json');
const LOCAL_CONFIG_PATH = path.resolve(here, '../config/llm.local.json');

const DEFAULTS = {
	provider: 'openai-compatible',
	baseUrl: '',
	apiKey: '',
	model: '',
	temperature: 0.4,
	timeoutMs: 30000,
	profiles: {},
};

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return {};
	}
}

/**
 * 读取 LLM 配置。
 * 优先级：环境变量 > config/llm.local.json（不入库）> config/llm.json（模板）
 *
 * 传入 profile 时，在基础配置之上叠加 profiles[profile]，
 * 这样一个文件里可以同时放多个厂商，按 `--p1 llm:doubao` 这种方式选用。
 */
export function loadLlmConfig(profile) {
	const config = { ...DEFAULTS, ...readJson(CONFIG_PATH), ...readJson(LOCAL_CONFIG_PATH) };

	if (profile) {
		const overlay = config.profiles?.[profile];
		if (!overlay) {
			const names = Object.keys(config.profiles || {});
			throw new Error(
				`未知的模型配置 "${profile}"，请先在 config/llm.local.json 的 profiles 里定义` +
				(names.length ? `（现有：${names.join('、')}）` : '')
			);
		}
		return { ...config, ...overlay, profiles: config.profiles };
	}

	if (process.env.POKE_LLM_BASE_URL) config.baseUrl = process.env.POKE_LLM_BASE_URL;
	if (process.env.POKE_LLM_API_KEY) config.apiKey = process.env.POKE_LLM_API_KEY;
	if (process.env.POKE_LLM_MODEL) config.model = process.env.POKE_LLM_MODEL;
	return config;
}

export function isConfigured(config) {
	return Boolean(config.baseUrl && config.apiKey && config.model);
}
