// fileHandling.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const tempDir = path.join(__dirname, 'temp');

function ensureTempDirectory() {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    return tempDir;
}

async function downloadAndSaveFile(fileLink, filePath) {
    try {
        const response = await axios({ url: fileLink, responseType: 'stream' });
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (err) {
        console.error(`Error downloading or saving file: ${err.message}`);
        throw err;
    }
}

module.exports = {
    ensureTempDirectory,
    downloadAndSaveFile,
    tempDir
};
