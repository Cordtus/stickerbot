// sessionManager.js

import fs from 'fs';
import path from 'path';
import { tempDir } from './fileHandler.js';

const sessions = {};
const cooldowns = {}; // Store user cooldowns

// Enhanced logger
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

// Retrieve or create a session for a user/chat
function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = {
            lastAction: null, // Last action performed by the user
            images: [], // List of images currently being processed
            messageId: null, // For tracking specific messages if needed
            timestamp: new Date(), // Last activity timestamp
            mode: null, // Current mode selected by the user (e.g., 'icon' or 'sticker')
            isProcessing: false, // Whether user has an active video processing job
            processingType: null, // Type of processing ('video', 'image', etc.)
            processingStartTime: null // When processing started
        };
    }

    // Update the timestamp to reflect recent activity
    sessions[chatId].timestamp = new Date();
    return sessions[chatId];
}

// Set processing state for a user
function setProcessingState(chatId, isProcessing, type = 'video') {
    const session = getSession(chatId);
    session.isProcessing = isProcessing;
    session.processingType = isProcessing ? type : null;
    session.processingStartTime = isProcessing ? new Date() : null;
    
    logWithContext('sessionManager', `User ${chatId} processing state: ${isProcessing ? 'started' : 'finished'} ${type || ''}`);
}

// Check if user is currently processing
function isUserProcessing(chatId) {
    const session = sessions[chatId];
    if (!session) return false;
    
    // Check if processing has been going on too long (timeout after 10 minutes)
    if (session.isProcessing && session.processingStartTime) {
        const processingTime = Date.now() - session.processingStartTime.getTime();
        if (processingTime > 10 * 60 * 1000) { // 10 minutes
            logWithContext('sessionManager', `Processing timeout for user ${chatId}, clearing state`);
            setProcessingState(chatId, false);
            return false;
        }
    }
    
    return session.isProcessing;
}

// Set cooldown for a user
function setCooldown(userId, type, durationSeconds) {
    if (!cooldowns[userId]) {
        cooldowns[userId] = {};
    }
    
    const expiresAt = Date.now() + (durationSeconds * 1000);
    cooldowns[userId][type] = expiresAt;
    
    logWithContext('sessionManager', `Set ${durationSeconds}s cooldown for user ${userId} (${type})`);
}

// Check cooldown remaining time
function checkCooldown(userId, type) {
    if (!cooldowns[userId] || !cooldowns[userId][type]) {
        return 0; // No cooldown
    }
    
    const expiresAt = cooldowns[userId][type];
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    
    if (remaining === 0) {
        // Cooldown expired, clean it up
        delete cooldowns[userId][type];
        if (Object.keys(cooldowns[userId]).length === 0) {
            delete cooldowns[userId];
        }
    }
    
    return remaining;
}

// Get cooldown info for user
function getCooldownInfo(userId) {
    if (!cooldowns[userId]) return {};
    
    const info = {};
    for (const [type, expiresAt] of Object.entries(cooldowns[userId])) {
        const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        if (remaining > 0) {
            info[type] = remaining;
        }
    }
    
    return info;
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
            logWithContext('sessionManager', `Purged inactive session for chat ${chatId}`);
        }
    });
    
    // Clean up expired cooldowns
    Object.keys(cooldowns).forEach(userId => {
        const userCooldowns = cooldowns[userId];
        Object.keys(userCooldowns).forEach(type => {
            if (userCooldowns[type] < Date.now()) {
                delete userCooldowns[type];
            }
        });
        
        if (Object.keys(userCooldowns).length === 0) {
            delete cooldowns[userId];
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
        logWithContext('sessionManager', `Manually cleared session for chat ${chatId}`);
    }
}

// Clear cooldowns for a user
function clearCooldowns(userId) {
    if (cooldowns[userId]) {
        delete cooldowns[userId];
        logWithContext('sessionManager', `Cleared all cooldowns for user ${userId}`);
    }
}

// Get session statistics
function getSessionStats() {
    const activeSessions = Object.keys(sessions).length;
    const processingSessions = Object.values(sessions).filter(s => s.isProcessing).length;
    const activeCooldowns = Object.keys(cooldowns).length;
    
    return {
        activeSessions,
        processingSessions,
        activeCooldowns
    };
}

export { 
    getSession, 
    clearSession,
    setProcessingState,
    isUserProcessing,
    setCooldown,
    checkCooldown,
    getCooldownInfo,
    clearCooldowns,
    getSessionStats
};