const ANI_URL = id => `https://play.pokemonshowdown.com/sprites/gen5ani/${id}.gif`;

const cache = new Map();

/**
 * 检查某个立绘是否有 gen5 动画 GIF。
 * 缺失时 CDN 会返回 404 + text/html，浏览器会报 ERR_BLOCKED_BY_ORB，
 * 所以在生成回放时先探一遍，按结果直接选用静态图。
 */
export async function hasAnimatedSprite(spriteId) {
	if (!spriteId) return false;
	if (cache.has(spriteId)) return cache.get(spriteId);
	let available = false;
	try {
		const res = await fetch(ANI_URL(spriteId), {
			method: 'HEAD',
			signal: AbortSignal.timeout(5000),
		});
		available = res.ok;
	} catch {
		// 探测失败（离线等）时按静态图处理，避免页面里出现一堆被拦截的请求
		available = false;
	}
	cache.set(spriteId, available);
	return available;
}

/** 为回放中出现的所有宝可梦生成立绘可用性表 */
export async function buildSpriteManifest(replay) {
	const ids = new Set();
	for (const player of replay.meta.players) {
		for (const mon of player.team) ids.add(mon.sprite);
	}
	for (const mon of replay.draft?.pool ?? []) ids.add(mon.sprite);
	const pairs = await Promise.all(
		[...ids].map(async id => [id, await hasAnimatedSprite(id)])
	);
	return Object.fromEntries(pairs);
}
