// sessionManager.js

import { logWithContext } from './logger.js';
import { tempDir, getTempPath, formatDate } from './utils.js';
import { batchDeleteFiles, safeDeleteFile } from './fileHandler.js';

// In-memory session storage
const sessions = {};

/**
 * Retrieve or create a session for a user/chat
 * @param {number|string} chatId - Chat/user ID
 * @returns {object} Session object
 */
function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = {
            lastAction: null, // Last action performed by the user
            images: [], // List of images currently being processed
            messageId: null, // For tracking specific messages if needed
            timestamp: new Date(), // Last activity timestamp
            mode: null, // Current mode selected by the user (e.g., 'icon' or 'sticker')
            sessionId: `session_${formatDate(new Date(), 'filename')}_${chatId}` // Unique session ID
        };
        
        logWithContext('sessionManager', `Created new session for chat ${chatId} with ID ${sessions[chatId].sessionId}`);
    }

    // Update the timestamp to reflect recent activity
    sessions[chatId].timestamp = new Date();
    return sessions[chatId];
}

/**
 * Periodically purge sessions to clean up unused data and temp files
 */
function purgeSessions() {
    const now = new Date();
    const maxAge = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
    let purgedCount = 0;
    let totalFiles = 0;
    
    logWithContext('sessionManager', 'Starting session purge process');

    Object.keys(sessions).forEach(chatId => {
        const session = sessions[chatId];
        // Purge session if inactive for more than 6 hours
        if (now - session.timestamp > maxAge) {
            // Collect files to delete
            const filesToDelete = session.images
                .filter(image => image.filename)
                .map(image => getTempPath(image.filename));
                
            totalFiles += filesToDelete.length;
            
            // Batch delete files
            if (filesToDelete.length > 0) {
                const result = batchDeleteFiles(filesToDelete, 'sessionManager');
                logWithContext('sessionManager', `Deleted ${result.success} files for session ${session.sessionId}`);
            }

            // Remove session from memory
            delete sessions[chatId];
            purgedCount++;
        }
    });

    logWithContext('sessionManager', `Session purge complete: removed ${purgedCount} sessions and ${totalFiles} files`);
}

// Schedule session purging to run every hour
const PURGE_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
setInterval(purgeSessions, PURGE_INTERVAL);

/**
 * Clear a user's session manually
 * @param {number|string} chatId - Chat/user ID
 */
function clearSession(chatId) {
    if (sessions[chatId]) {
        // Get list of files to delete
        const filesToDelete = sessions[chatId].images
            .filter(image => image.filename)
            .map(image => getTempPath(image.filename));
            
        // Batch delete files
        if (filesToDelete.length > 0) {
            batchDeleteFiles(filesToDelete, 'sessionManager');
        }

        logWithContext('sessionManager', `Manually cleared session for chat ${chatId}`);
        
        // Remove the session
        delete sessions[chatId];
    }
}

export { getSession, clearSession };