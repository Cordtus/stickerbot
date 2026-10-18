import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { formatTelegramDownloadError, resolveTelegramFile } from '../src/telegramFiles.js';
import { downloadVideoFile } from '../src/videoProcessor.js';

test('Telegram file gateway receives absolute local Bot API paths', async (t) => {
	let requestURL;
	const server = createServer((request, response) => {
		requestURL = new URL(request.url, 'http://gateway.test');
		response.end('local bytes');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const { port } = server.address();
	const localPath = '/var/lib/telegram-bot-api/state/123456:secret/videos/file_0.mp4';
	const ctx = {
		telegram: {
			getFile: async () => ({ file_path: localPath, file_size: 11 }),
			getFileLink: async () => { throw new Error('public link must not be requested'); },
		},
	};

	const result = await resolveTelegramFile(ctx, 'file-id', {
		botToken: '123456:secret',
		fileRoot: `http://127.0.0.1:${port}`,
	});
	const response = await fetch(result.url);

	assert.equal(await response.text(), 'local bytes');
	assert.equal(requestURL.pathname, '/file/bot123456:secret');
	assert.equal(requestURL.searchParams.get('path'), localPath);
	assert.doesNotMatch(result.url, /api\.telegram\.org/);
});

test('Telegram files retain Telegraf public links for relative file paths', async () => {
	let linkedFileID;
	const ctx = {
		telegram: {
			getFile: async () => ({ file_path: 'photos/file_0.jpg', file_size: 42 }),
			getFileLink: async (fileID) => {
				linkedFileID = fileID;
				return 'https://api.telegram.org/file/bot123/photos/file_0.jpg';
			},
		},
	};

	const result = await resolveTelegramFile(ctx, 'relative-file', {
		botToken: '123456:secret',
		fileRoot: 'http://gateway.test:8082',
	});

	assert.equal(linkedFileID, 'relative-file');
	assert.equal(result.url, 'https://api.telegram.org/file/bot123/photos/file_0.jpg');
	assert.equal(result.file.file_size, 42);
});

test('Telegram files reject absolute paths without a configured file gateway', async () => {
	const ctx = {
		telegram: {
			getFile: async () => ({ file_path: '/private/state/file.bin' }),
			getFileLink: async () => { throw new Error('must not request a public link'); },
		},
	};

	await assert.rejects(
		() => resolveTelegramFile(ctx, 'local-file', { botToken: '123456:secret' }),
		/TELEGRAM_FILE_ROOT is required for local Bot API files/,
	);
});

test('Telegram file resolution reads production roots at call time', async (t) => {
	const previousRoot = process.env.TELEGRAM_FILE_ROOT;
	process.env.TELEGRAM_FILE_ROOT = 'http://gateway.internal:8082';
	t.after(() => {
		if (previousRoot === undefined) {
			delete process.env.TELEGRAM_FILE_ROOT;
		} else {
			process.env.TELEGRAM_FILE_ROOT = previousRoot;
		}
	});
	const ctx = {
		telegram: {
			getFile: async () => ({ file_path: '/state/123456:secret/videos/file.mp4' }),
		},
	};

	const result = await resolveTelegramFile(ctx, 'local-file', { botToken: '123456:secret' });

	assert.equal(new URL(result.url).origin, 'http://gateway.internal:8082');
});

test('Telegram file download errors retain safe timeout, status, and cause details', () => {
	const error = Object.assign(new Error('request to https://gateway.test/file/bot123456:secret failed'), {
		name: 'AxiosError',
		code: 'ETIMEDOUT',
		response: { status: 504 },
		cause: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
	});

	const description = formatTelegramDownloadError(error);

	assert.match(description, /AxiosError/);
	assert.match(description, /ETIMEDOUT/);
	assert.match(description, /504/);
	assert.match(description, /ECONNRESET/);
	assert.doesNotMatch(description, /123456:secret|gateway\.test|\/file\//);
});

test('video downloads propagate a sanitized mid-stream failure instead of hanging', async (t) => {
	const server = createServer((request, response) => {
		response.writeHead(200, { 'content-length': '1024' });
		response.write('partial');
		setImmediate(() => response.destroy());
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const { port } = server.address();
	const ctx = {
		telegram: {
			getFile: async () => ({ file_path: 'videos/file.mp4', file_size: 1024 }),
			getFileLink: async () => `http://127.0.0.1:${port}/truncated`,
		},
	};

	await assert.rejects(
		() => downloadVideoFile(ctx, 'truncated-video'),
		(error) => {
			assert.match(error.message, /^Download failed: /);
			assert.doesNotMatch(error.message, /truncated-video|127\.0\.0\.1|\/truncated/);
			return true;
		},
	);
});

test('video downloads enforce an end-to-end deadline against trickling streams', async (t) => {
	const server = createServer((request, response) => {
		response.writeHead(200, { 'content-length': '1048576' });
		const interval = setInterval(() => response.write('x'), 5);
		response.on('close', () => clearInterval(interval));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const { port } = server.address();
	const ctx = {
		telegram: {
			getFile: async () => ({ file_path: 'videos/file.mp4', file_size: 1024 }),
			getFileLink: async () => `http://127.0.0.1:${port}/trickling`,
		},
	};

	await assert.rejects(
		() => downloadVideoFile(ctx, 'slow-video', { timeoutMs: 40 }),
		(error) => {
			assert.match(error.message, /TimeoutError.*ETIMEDOUT/);
			assert.doesNotMatch(error.message, /slow-video|127\.0\.0\.1|\/trickling/);
			return true;
		},
	);
});
