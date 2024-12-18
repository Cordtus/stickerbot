import fs from 'fs';
import path from 'path';
import axios from 'axios';

const tempDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'temp');

function ensureTempDirectory() {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
}

async function downloadAndSaveFile(fileLink, userId) {
    try {
        ensureTempDirectory();
        const timestamp = Date.now();
        const filename = `${userId}-${timestamp}.webp`;
        const filePath = path.join(tempDir, filename);

        const response = await axios({ url: fileLink, responseType: 'stream' });
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        return filePath; // Return the path for further use
    } catch (err) {
        console.error(`Error downloading or saving file: ${err.message}`);
        throw err;
    }
}

export {
    ensureTempDirectory,
    downloadAndSaveFile,
    tempDir
};
