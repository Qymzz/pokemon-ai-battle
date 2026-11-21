import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * 用 Edge TTS 合成中文语音，返回 mp3 buffer。
 * 不需要 API key；网络异常时重试一次。
 */
export async function synthesize(text, { voice, rate = '+8%' } = {}) {
	let lastError;
	for (let attempt = 1; attempt <= 2; attempt++) {
		const tts = new MsEdgeTTS();
		try {
			await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
			const { audioStream } = tts.toStream(text, { rate });
			const chunks = [];
			for await (const chunk of audioStream) chunks.push(chunk);
			const buffer = Buffer.concat(chunks);
			if (!buffer.length) throw new Error('返回了空音频');
			return buffer;
		} catch (error) {
			lastError = error;
		} finally {
			try {
				tts.close();
			} catch {
				// 关闭失败不影响结果
			}
		}
	}
	throw lastError;
}
