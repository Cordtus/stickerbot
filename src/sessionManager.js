const fs = require('fs');
const path = require('path');
const { tempDir } = require('./fileHandling');

const sessions = {};


function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = { lastAction: null, images: [], messageId: null, timestamp: new Date() };
    }
    return sessions[chatId];
}

function purgeSessions() {
    const now = new Date();
    Object.keys(sessions).forEach(chatId => {
        if (now - sessions[chatId].timestamp > 21600000) { // 6 hours in milliseconds
            // Delete saved images for this session
            sessions[chatId].images.forEach(image => fs.unlinkSync(path.join(tempDir, image.filename)));
            delete sessions[chatId];
        }
    });
}

setInterval(purgeSessions, 3600000); // Run every hour

module.exports = { getSession };
