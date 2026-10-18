// fileHandler.js

import fs from 'fs';
import { tempDir } from './runtimePaths.js';

function ensureTempDirectory() {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
}

export {
    ensureTempDirectory,
    tempDir
};
