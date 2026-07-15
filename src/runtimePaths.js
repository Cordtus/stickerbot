import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const defaultApplicationRoot = path.resolve(sourceDir, '..');

function resolveRuntimePaths({
	applicationRoot = defaultApplicationRoot,
} = {}) {
	const resolvedRoot = path.resolve(applicationRoot);
	return {
		applicationRoot: resolvedRoot,
		dataDir: path.join(resolvedRoot, 'data'),
		tempDir: path.join(resolvedRoot, 'temp'),
	};
}

function initializeRuntimePaths(options = {}) {
	const paths = resolveRuntimePaths(options);
	fs.mkdirSync(paths.dataDir, { recursive: true });
	fs.mkdirSync(paths.tempDir, { recursive: true });
	return paths;
}

const {
	applicationRoot,
	dataDir,
	tempDir,
} = resolveRuntimePaths();

export {
	applicationRoot,
	dataDir,
	initializeRuntimePaths,
	resolveRuntimePaths,
	tempDir,
};
