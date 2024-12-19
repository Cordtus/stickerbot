// sessionManager.js

import fs from 'fs';
import path from 'path';
import { tempDir } from './fileHandler.js';

const sessions = {};

// Retrieve or create a session for a user/chat
function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = {
            lastAction: null, // Last action performed by the user
            images: [], // List of images currently being processed
            messageId: null, // For tracking specific messages if needed
            timestamp: new Date(), // Last activity timestamp
            mode: null // Current mode selected by the user (e.g., 'icon' or 'sticker')
        };
    }

    // Update the timestamp to reflect recent activity
    sessions[chatId].timestamp = new Date();
    return sessions[chatId];
}

// Periodically purge sessions to clean up unused data and temp files
function purgeSessions() {
    const now = new Date();

    Object.keys(sessions).forEach(chatId => {
        const session = sessions[chatId];
        // Purge session if inactive for more than 6 hours
        if (now - session.timestamp > 21600000) { // 6 hours in milliseconds
            // Clean up associated files
            session.images.forEach(image => {
                const imagePath = path.join(tempDir, image.filename);
                if (fs.existsSync(imagePath)) {
                    try {
                        fs.unlinkSync(imagePath);
                    } catch (err) {
                        console.warn(`Failed to delete file ${imagePath}: ${err.message}`);
                    }
                }
            });

            // Remove session from memory
            delete sessions[chatId];
        }
    });
}

// Schedule session purging to run every hour
setInterval(purgeSessions, 3600000); // Every 1 hour

// Clear a user's session manually
function clearSession(chatId) {
    if (sessions[chatId]) {
        // Delete temp files associated with the session
        sessions[chatId].images.forEach(image => {
            const imagePath = path.join(tempDir, image.filename);
            if (fs.existsSync(imagePath)) {
                try {
                    fs.unlinkSync(imagePath);
                } catch (err) {
                    console.warn(`Failed to delete file ${imagePath}: ${err.message}`);
                }
            }
        });

        // Remove the session
        delete sessions[chatId];
    }
}

export { getSession, clearSession };
