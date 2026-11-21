/** 把单个数字种子展开成 Showdown 需要的 4 段 seed（形如 "a,b,c,d"） */
export function prngSeed(base, offset = 0) {
	const a = (base + offset) % 65500;
	const b = ((base * 31 + offset * 17) % 65500) + 1;
	const c = ((offset * 7919 + 13) % 65500) + 1;
	const d = (base % 89) + 7;
	return `${a},${b},${c},${d}`;
}
