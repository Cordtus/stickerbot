import http from 'node:http';
import https from 'node:https';

const publicApiRoot = 'https://api.telegram.org';

function normalizeRoot(value, name) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be an absolute HTTP(S) URL`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${name} must use HTTP or HTTPS`);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error(`${name} must not include credentials, a query, or a fragment`);
	}

	if (url.pathname.replace(/\/+$/, '') !== '') {
		throw new Error(`${name} must not include a path prefix`);
	}
	return url.origin;
}

function createTelegramAgent(apiRoot, options = {}) {
	const Agent = new URL(apiRoot).protocol === 'http:' ? http.Agent : https.Agent;
	return new Agent({
		family: 4,
		keepAlive: true,
		keepAliveMsecs: 30000,
		timeout: 30000,
		maxSockets: 10,
		maxFreeSockets: 10,
		...options,
	});
}

function buildTelegramMethodUrl(apiRoot, token, method) {
	return new URL(`/bot${token}/${method}`, `${apiRoot}/`);
}

function createTelegramConfig(environment = process.env) {
	const apiRoot = normalizeRoot(environment.TELEGRAM_API_ROOT || publicApiRoot, 'TELEGRAM_API_ROOT');
	const fileRoot = environment.TELEGRAM_FILE_ROOT
		? normalizeRoot(environment.TELEGRAM_FILE_ROOT, 'TELEGRAM_FILE_ROOT')
		: undefined;

	return {
		apiRoot,
		fileRoot,
		agent: createTelegramAgent(apiRoot),
		connectivityUrl: new URL('/', `${apiRoot}/`).toString(),
	};
}

function applyTelegramAgent(telegram, config) {
	if (!telegram?.options) {
		throw new Error('Telegram client options are required');
	}
	telegram.options.agent = config.agent;
	return telegram;
}

export {
	applyTelegramAgent,
	buildTelegramMethodUrl,
	createTelegramAgent,
	createTelegramConfig,
};
