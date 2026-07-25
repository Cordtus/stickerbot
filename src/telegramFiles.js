import path from 'node:path';
import { createTelegramConfig } from './telegramConfig.js';

function resolveTelegramFile(ctx, fileId, options = {}) {
	const config = createTelegramConfig();
	return resolveFile(ctx, fileId, {
		botToken: options.botToken ?? process.env.BOT_TOKEN,
		fileRoot: options.fileRoot ?? config.fileRoot,
	});
}

async function resolveFile(ctx, fileId, { botToken, fileRoot }) {
	const file = await ctx.telegram.getFile(fileId);
	if (!file.file_path || !path.isAbsolute(file.file_path)) {
		return { file, url: await ctx.telegram.getFileLink(fileId) };
	}

	if (!fileRoot) {
		throw new Error('TELEGRAM_FILE_ROOT is required for local Bot API files');
	}
	if (!botToken) {
		throw new Error('BOT_TOKEN is required for local Bot API files');
	}

	const fileURL = new URL(`/file/bot${botToken}`, `${fileRoot}/`);
	fileURL.searchParams.set('path', file.file_path);
	return { file, url: fileURL.toString() };
}

async function fetchTelegramFile(ctx, fileId, options = {}) {
	const { fetchImpl = globalThis.fetch, ...resolutionOptions } = options;
	const resolved = await resolveTelegramFile(ctx, fileId, resolutionOptions);

	try {
		const response = await fetchImpl(resolved.url);
		if (!response.ok) {
			throw { name: 'HTTPError', status: response.status };
		}
		return { ...resolved, buffer: Buffer.from(await response.arrayBuffer()) };
	} catch (error) {
		throw new Error(`Download failed: ${formatTelegramDownloadError(error)}`);
	}
}

function formatTelegramDownloadError(error) {
	const details = [];
	let current = error;
	for (let depth = 0; current && depth < 3; depth += 1) {
		const fields = [];
		if (typeof current.name === 'string' && /^[A-Za-z0-9_-]+$/.test(current.name)) {
			fields.push(current.name);
		}
		if (typeof current.code === 'string' && /^[A-Za-z0-9_-]+$/.test(current.code)) {
			fields.push(`code=${current.code}`);
		}
		const status = current.response?.status ?? current.status;
		if (Number.isInteger(status) && status >= 100 && status <= 599) {
			fields.push(`status=${status}`);
		}
		if (fields.length > 0) {
			details.push(fields.join(' '));
		}
		current = current.cause;
	}
	return details.join(' cause=') || 'unknown download error';
}

export {
	fetchTelegramFile,
	formatTelegramDownloadError,
	resolveTelegramFile,
};
