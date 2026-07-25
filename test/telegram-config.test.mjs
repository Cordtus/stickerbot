import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import test from 'node:test';
import { Telegram } from 'telegraf';
import { applyTelegramAgent, createTelegramConfig } from '../src/telegramConfig.js';

test('Telegram API defaults to the public HTTPS endpoint', () => {
	const config = createTelegramConfig({});

	assert.equal(config.apiRoot, 'https://api.telegram.org');
	assert.equal(config.fileRoot, undefined);
	assert.ok(config.agent instanceof https.Agent);
	assert.equal(config.connectivityUrl, 'https://api.telegram.org/');
});

test('Telegram API normalizes a local HTTP root and uses its keepalive agent without public hostname', async (t) => {
	let receivedRequest = false;
	const server = http.createServer((request, response) => {
		receivedRequest = request.url === '/';
		response.end('ok');
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const { port } = server.address();

	const config = createTelegramConfig({
		TELEGRAM_API_ROOT: `http://127.0.0.1:${port}/`,
		TELEGRAM_FILE_ROOT: `http://127.0.0.1:${port}/`,
	});

	assert.equal(config.apiRoot, `http://127.0.0.1:${port}`);
	assert.equal(config.fileRoot, `http://127.0.0.1:${port}`);
	assert.ok(config.agent instanceof http.Agent);
	assert.equal(config.connectivityUrl, `http://127.0.0.1:${port}/`);
	assert.doesNotMatch(config.connectivityUrl, /api\.telegram\.org/);

	await new Promise((resolve, reject) => {
		http.get(config.connectivityUrl, { agent: config.agent }, (response) => {
			response.resume();
			response.on('end', resolve);
		}).on('error', reject);
	});
	assert.equal(receivedRequest, true);
});

test('Telegram API rejects roots with credentials, queries, or unsupported protocols', () => {
	for (const variable of ['TELEGRAM_API_ROOT', 'TELEGRAM_FILE_ROOT']) {
		for (const root of [
			'https://token@example.test',
			'https://example.test?token=secret',
			'https://example.test/prefix',
			'ftp://example.test',
		]) {
			assert.throws(() => createTelegramConfig({ [variable]: root }), new RegExp(variable));
		}
	}
});

test('local HTTP Telegram calls retain the configured agent after Telegraf construction', async (t) => {
	let requestPath;
	const server = http.createServer((request, response) => {
		requestPath = request.url;
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({
			ok: true,
			result: { id: 12345, is_bot: true, first_name: 'Test', username: 'test_bot' },
		}));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => server.close());
	const { port } = server.address();
	const config = createTelegramConfig({ TELEGRAM_API_ROOT: `http://127.0.0.1:${port}` });
	const telegram = new Telegram('12345:test', {
		apiRoot: config.apiRoot,
		agent: config.agent,
	});

	applyTelegramAgent(telegram, config);
	const me = await telegram.getMe();

	assert.equal(telegram.options.agent, config.agent);
	assert.equal(requestPath, '/bot12345:test/getMe');
	assert.equal(me.username, 'test_bot');
});
