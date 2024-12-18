// sessionManager.js

import fs from 'fs';
import path from 'path';
import { tempDir } from './fileHandling.js';

const sessions = {};

function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = {
            lastAction: null,
            images: [],
            messageId: null,
            timestamp: new Date(),
            mode: null // Added to track the user's selected mode
        };
    }
    sessions[chatId].timestamp = new Date(); // Update timestamp on access
    return sessions[chatId];
}

function purgeSessions() {
    const now = new Date();
    Object.keys(sessions).forEach(chatId => {
        if (now - sessions[chatId].timestamp > 21600000) { // 6 hours in milliseconds
            // Delete saved images for this session
            sessions[chatId].images.forEach(image => {
                const imagePath = path.join(tempDir, image.filename);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            });
            delete sessions[chatId];
        }
    });
}

setInterval(purgeSessions, 3600000); // Run every hour

export { getSession };
