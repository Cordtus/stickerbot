import assert from 'node:assert/strict';
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('runtime initialization creates writable data and temp paths outside immutable source', async (t) => {
	const applicationRoot = mkdtempSync(path.join(tmpdir(), 'stickerbot-runtime-'));
	t.after(() => rmSync(applicationRoot, { force: true, recursive: true }));
	const sourceDir = path.join(applicationRoot, 'src');
	mkdirSync(sourceDir);
	chmodSync(sourceDir, 0o555);

	const runtimeModule = await import('../src/runtimePaths.js').catch(() => ({}));
	assert.equal(typeof runtimeModule.initializeRuntimePaths, 'function');

	const paths = runtimeModule.initializeRuntimePaths({
		applicationRoot,
		environment: {
			STICKERBOT_TEMP_DIR: path.join(applicationRoot, 'undeclared-temp'),
		},
	});
	assert.deepEqual(paths, {
		applicationRoot,
		dataDir: path.join(applicationRoot, 'data'),
		tempDir: path.join(applicationRoot, 'temp'),
	});

	writeFileSync(path.join(paths.dataDir, 'database-write-check'), 'data-ok\n');
	writeFileSync(path.join(paths.tempDir, 'media-write-check'), 'temp-ok\n');
	assert.equal(readFileSync(path.join(paths.dataDir, 'database-write-check'), 'utf8'), 'data-ok\n');
	assert.equal(readFileSync(path.join(paths.tempDir, 'media-write-check'), 'utf8'), 'temp-ok\n');
	assert.equal(existsSync(path.join(sourceDir, 'data')), false);
});
