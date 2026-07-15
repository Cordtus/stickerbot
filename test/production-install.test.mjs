import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function executable(filePath, contents) {
	writeFileSync(filePath, contents);
	chmodSync(filePath, 0o755);
}

function mode(filePath) {
	return statSync(filePath).mode & 0o7777;
}

function parseUnit(filePath) {
	const sections = {};
	let section = '';
	for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		if (line.startsWith('[') && line.endsWith(']')) {
			section = line.slice(1, -1);
			sections[section] = [];
			continue;
		}
		sections[section]?.push(line);
	}
	return sections;
}

test('production unit exposes only the intended identity, runtime, and mutable paths', () => {
	const unit = parseUnit(path.join(PROJECT_DIR, 'stickerbot.service'));
	assert.deepEqual(unit.Unit, [
		'Description=Telegram StickerBot',
		'After=network-online.target',
		'Wants=network-online.target',
	]);
	assert.deepEqual(unit.Service, [
		'Type=simple',
		'User=stickerbot',
		'Group=stickerbot',
		'WorkingDirectory=/opt/stickerbot',
		'EnvironmentFile=/etc/stickerbot/stickerbot.env',
		'ExecStart=/opt/node-v22/bin/node src/bot.js',
		'Restart=on-failure',
		'RestartSec=5',
		'UMask=0077',
		'NoNewPrivileges=true',
		'PrivateTmp=true',
		'ProtectSystem=strict',
		'ProtectHome=true',
		'ReadWritePaths=/opt/stickerbot/data /opt/stickerbot/temp',
	]);
	assert.deepEqual(unit.Install, ['WantedBy=multi-user.target']);
});

test('production installer preserves state, installs native dependencies, and leaves the unit waiting inactive', () => {
	const root = mkdtempSync(path.join(tmpdir(), 'stickerbot-install-'));
	const sourceDir = path.join(root, 'source');
	const installDir = path.join(root, 'installed');
	const unitDir = path.join(root, 'units');
	const envDir = path.join(root, 'etc');
	const binDir = path.join(root, 'bin');
	const commandLog = path.join(root, 'commands.log');
	const privilegeLog = path.join(root, 'privileged.log');
	mkdirSync(sourceDir);
	mkdirSync(path.join(installDir, 'data'), { recursive: true });
	mkdirSync(path.join(installDir, 'temp'), { recursive: true });
	mkdirSync(binDir);
	cpSync(path.join(PROJECT_DIR, 'src'), path.join(sourceDir, 'src'), { recursive: true });
	cpSync(path.join(PROJECT_DIR, 'scripts'), path.join(sourceDir, 'scripts'), { recursive: true });
	for (const file of ['package.json', 'package-lock.json', 'README.md', 'stickerbot.service']) {
		cpSync(path.join(PROJECT_DIR, file), path.join(sourceDir, file));
	}
	writeFileSync(path.join(sourceDir, '.env'), 'BOT_TOKEN=must-not-copy\n');
	mkdirSync(path.join(sourceDir, 'node_modules'));
	writeFileSync(path.join(sourceDir, 'node_modules/arm-native.node'), 'arm-cache\n');
	mkdirSync(path.join(sourceDir, '.npm'));
	writeFileSync(path.join(sourceDir, '.npm/cache'), 'cache\n');
	writeFileSync(path.join(installDir, 'data/stickerpacks.db'), 'persistent-db\n');
	writeFileSync(path.join(installDir, 'temp/in-flight.tmp'), 'keep-during-install\n');

	executable(path.join(binDir, 'sudo'), [
		'#!/usr/bin/env bash',
		'printf "%s\\n" "$*" >> "$PRIVILEGE_LOG"',
		'if [[ "$1" == "chown" ]]; then exit 0; fi',
		'exec "$@"',
		'',
	].join('\n'));
	executable(path.join(binDir, 'npm'), [
		'#!/usr/bin/env bash',
		'printf "npm cwd=%s args=%s\\n" "$PWD" "$*" >> "$COMMAND_LOG"',
		'mkdir -p node_modules',
		'printf "target-native\\n" > node_modules/target-native.node',
		'',
	].join('\n'));
	executable(path.join(binDir, 'node'), [
		'#!/usr/bin/env bash',
		'printf "node %s\\n" "$*" >> "$COMMAND_LOG"',
		'exit 0',
		'',
	].join('\n'));
	executable(path.join(binDir, 'ffmpeg'), [
		'#!/usr/bin/env bash',
		'printf "ffmpeg %s\\n" "$*" >> "$COMMAND_LOG"',
		'if [[ "$1" == "-version" ]]; then exit 0; fi',
		'if [[ "$*" == *"-encoders"* ]]; then printf " V..... libvpx-vp9 VP9 encoder\\n"; exit 0; fi',
		'output="${@: -1}"',
		'printf "webm-smoke\\n" > "$output"',
		'exit 0',
		'',
	].join('\n'));
	executable(path.join(binDir, 'ffprobe'), [
		'#!/usr/bin/env bash',
		'printf "ffprobe %s\\n" "$*" >> "$COMMAND_LOG"',
		'if [[ "$1" == "-version" ]]; then exit 0; fi',
		'if [[ "$*" == *"show_entries"* ]]; then',
		'  printf "codec_name=vp9\\nwidth=64\\nheight=64\\n"',
		'fi',
		'exit 0',
		'',
	].join('\n'));
	executable(path.join(binDir, 'timeout'), [
		'#!/usr/bin/env bash',
		'printf "timeout %s\\n" "$*" >> "$COMMAND_LOG"',
		'shift',
		'exec "$@"',
		'',
	].join('\n'));
	executable(path.join(binDir, 'systemctl'), [
		'#!/usr/bin/env bash',
		'printf "systemctl %s\\n" "$*" >> "$COMMAND_LOG"',
		'exit 91',
		'',
	].join('\n'));

	const user = process.env.USER || 'cordt';
	const group = execFileSync('id', ['-gn'], { encoding: 'utf8' }).trim();
	const result = spawnSync('bash', [path.join(PROJECT_DIR, 'scripts/install-production.sh')], {
		cwd: PROJECT_DIR,
		encoding: 'utf8',
		env: {
			...process.env,
			SOURCE_DIR: sourceDir,
			INSTALL_DIR: installDir,
			UNIT_DIR: unitDir,
			ENV_DIR: envDir,
			NODE_BIN: path.join(binDir, 'node'),
			NPM_BIN: path.join(binDir, 'npm'),
			FFMPEG_BIN: path.join(binDir, 'ffmpeg'),
			FFPROBE_BIN: path.join(binDir, 'ffprobe'),
			TIMEOUT_BIN: path.join(binDir, 'timeout'),
			SERVICE_USER: user,
			SERVICE_GROUP: group,
			SKIP_SYSTEM_USER: '1',
			ALLOW_UNPRIVILEGED_TEST: '1',
			COMMAND_LOG: commandLog,
			PRIVILEGE_LOG: privilegeLog,
			PATH: `${binDir}:${process.env.PATH || ''}`,
		},
	});
	assert.equal(result.status, 0, result.stderr);

	assert.equal(readFileSync(path.join(installDir, 'data/stickerpacks.db'), 'utf8'), 'persistent-db\n');
	assert.equal(readFileSync(path.join(installDir, 'temp/in-flight.tmp'), 'utf8'), 'keep-during-install\n');
	assert.equal(mode(installDir), 0o755);
	assert.equal(mode(path.join(installDir, 'data')), 0o700);
	assert.equal(mode(path.join(installDir, 'temp')), 0o700);
	assert.equal(existsSync(path.join(installDir, '.env')), false);
	assert.equal(existsSync(path.join(installDir, '.npm')), false);
	assert.equal(existsSync(path.join(installDir, 'node_modules/arm-native.node')), false);
	assert.equal(readFileSync(path.join(installDir, 'node_modules/target-native.node'), 'utf8'), 'target-native\n');
	assert.equal(existsSync(path.join(unitDir, 'stickerbot.service')), true);
	assert.equal(mode(path.join(unitDir, 'stickerbot.service')), 0o644);
	assert.equal(mode(envDir), 0o700);
	assert.equal(mode(path.join(envDir, 'stickerbot.env')), 0o600);
	assert.equal(readFileSync(path.join(envDir, 'stickerbot.env'), 'utf8'), 'BOT_TOKEN=REPLACE_BEFORE_START\n');
	assert.match(result.stdout, /REQUIRED ACTION.*stickerbot\.env/);

	const commands = readFileSync(commandLog, 'utf8');
	assert.match(commands, new RegExp(`npm cwd=${installDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} args=ci --omit=dev`));
	assert.match(commands, /node --input-type=module -e/);
	assert.match(commands, /ffmpeg -version/);
	assert.match(commands, /ffmpeg .* -encoders/);
	assert.match(commands, /ffmpeg .*libvpx-vp9/);
	assert.match(commands, /ffprobe -version/);
	assert.match(commands, /ffprobe .*show_entries.*codec_name,width,height/);
	assert.match(commands, /timeout 30/);
	assert.doesNotMatch(commands, /systemctl/);
	const privileged = readFileSync(privilegeLog, 'utf8');
	assert.match(privileged, new RegExp(`chown root:${group} ${installDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
	assert.match(privileged, new RegExp(`chown -R root:root ${installDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/src`));
	assert.match(privileged, new RegExp(`chown -R ${user}:${group} ${installDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/data ${installDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/temp`));
	assert.match(privileged, new RegExp(`chown root:root ${envDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/stickerbot.env`));

	writeFileSync(path.join(envDir, 'stickerbot.env'), 'BOT_TOKEN=super-secret-value\n');
	chmodSync(path.join(envDir, 'stickerbot.env'), 0o644);
	const reinstalled = spawnSync('bash', [path.join(PROJECT_DIR, 'scripts/install-production.sh')], {
		cwd: PROJECT_DIR,
		encoding: 'utf8',
		env: {
			...process.env,
			SOURCE_DIR: sourceDir,
			INSTALL_DIR: installDir,
			UNIT_DIR: unitDir,
			ENV_DIR: envDir,
			NODE_BIN: path.join(binDir, 'node'),
			NPM_BIN: path.join(binDir, 'npm'),
			FFMPEG_BIN: path.join(binDir, 'ffmpeg'),
			FFPROBE_BIN: path.join(binDir, 'ffprobe'),
			TIMEOUT_BIN: path.join(binDir, 'timeout'),
			SERVICE_USER: user,
			SERVICE_GROUP: group,
			SKIP_SYSTEM_USER: '1',
			ALLOW_UNPRIVILEGED_TEST: '1',
			COMMAND_LOG: commandLog,
			PRIVILEGE_LOG: privilegeLog,
			PATH: `${binDir}:${process.env.PATH || ''}`,
		},
	});
	assert.equal(reinstalled.status, 0, reinstalled.stderr);
	assert.equal(mode(path.join(envDir, 'stickerbot.env')), 0o600);
	assert.equal(readFileSync(path.join(envDir, 'stickerbot.env'), 'utf8'), 'BOT_TOKEN=super-secret-value\n');
	assert.doesNotMatch(`${reinstalled.stdout}\n${reinstalled.stderr}`, /super-secret-value/);
});

test('temporary processing defaults to the service-writable top-level temp directory', async () => {
	const moduleUrl = `${pathToFileURL(path.join(PROJECT_DIR, 'src/fileHandler.js')).href}?test=${Date.now()}`;
	const { tempDir } = await import(moduleUrl);
	assert.equal(tempDir, path.join(PROJECT_DIR, 'temp'));
});
