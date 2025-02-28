// stickerManager.js

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { downloadFile } from './imageProcessor.js';
import { ensureTempDirectory, tempDir } from './fileHandler.js';

// Store user sticker sets in memory (in production you'd use a database)
const userStickerSets = {};

/**
 * Get all sticker sets created by a user
 * @param {number} userId - Telegram user ID
 * @returns {Array} - Array of sticker set objects
 */
async function getUserStickerSets(userId) {
    if (!userStickerSets[userId]) {
        userStickerSets[userId] = [];
    }
    return userStickerSets[userId];
}

/**
 * Create a new sticker set for a user
 * @param {Object} ctx - Telegram context
 * @param {string} name - Short name for the sticker set
 * @param {string} title - Display title for the sticker set
 * @returns {Promise<boolean>} - Success status
 */
async function createStickerSet(ctx, name, title) {
    try {
        const userId = ctx.from.id;
        
        // In a real implementation, this would call the Telegram API:
        // ctx.telegram.createNewStickerSet(userId, name, title, emojis, pngSticker, options)
        console.log(`Creating sticker set: ${name} (${title}) for user ${userId}`);
        
        // For this demo, we'll simulate the API call
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Store in our in-memory database
        if (!userStickerSets[userId]) {
            userStickerSets[userId] = [];
        }
        
        // Check if name is already used
        const existingSet = userStickerSets[userId].find(set => set.name === name);
        if (existingSet) {
            throw new Error('A sticker set with this name already exists');
        }
        
        userStickerSets[userId].push({
            id: uuidv4(),
            name,
            title,
            created: new Date(),
            stickers: []
        });
        
        return true;
    } catch (error) {
        console.error(`Error creating sticker set: ${error.message}`);
        throw error;
    }
}

/**
 * Add a sticker to an existing set
 * @param {Object} ctx - Telegram context
 * @param {string} setName - Sticker set short name
 * @param {string} stickerPath - Path to the sticker file
 * @param {string} emoji - Associated emoji
 * @returns {Promise<boolean>} - Success status
 */
async function addStickerToSet(ctx, setName, stickerPath, emoji = '😊') {
    try {
        const userId = ctx.from.id;
        
        // In a real implementation, this would call the Telegram API:
        // ctx.telegram.addStickerToSet(userId, setName, pngSticker, emoji)
        console.log(`Adding sticker to set: ${setName} for user ${userId}, emoji: ${emoji}`);
        
        // For this demo, we'll simulate the API call
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Update our in-memory database
        if (!userStickerSets[userId]) {
            throw new Error('You have no sticker sets');
        }
        
        const setIndex = userStickerSets[userId].findIndex(set => set.name === setName);
        if (setIndex === -1) {
            throw new Error('Sticker set not found');
        }
        
        // Add sticker to the set
        userStickerSets[userId][setIndex].stickers.push({
            id: uuidv4(),
            emoji: emoji,
            added: new Date()
        });
        
        return true;
    } catch (error) {
        console.error(`Error adding sticker to set: ${error.message}`);
        throw error;
    }
}

/**
 * Get a specific sticker set
 * @param {number} userId - Telegram user ID
 * @param {string} setName - Sticker set short name
 * @returns {Object|null} - Sticker set or null if not found
 */
async function getStickerSet(userId, setName) {
    if (!userStickerSets[userId]) return null;
    
    return userStickerSets[userId].find(set => set.name === setName) || null;
}

/**
 * Delete a sticker set
 * @param {number} userId - Telegram user ID
 * @param {string} setName - Sticker set short name
 * @returns {boolean} - Success status
 */
async function deleteStickerSet(userId, setName) {
    if (!userStickerSets[userId]) return false;
    
    const initialLength = userStickerSets[userId].length;
    userStickerSets[userId] = userStickerSets[userId].filter(set => set.name !== setName);
    
    return userStickerSets[userId].length < initialLength;
}

/**
 * Generate a valid sticker set name
 * @param {Object} ctx - Telegram context
 * @param {string} title - User's desired title
 * @returns {string} - Valid sticker set name
 */
function generateStickerSetName(ctx, title) {
    // Remove non-alphanumeric characters and convert to lowercase
    const base = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Add bot username suffix as required by Telegram
    const botUsername = ctx.botInfo.username;
    const randomSuffix = Math.floor(Math.random() * 1000);
    
    return `${base}_${randomSuffix}_by_${botUsername}`;
}

export {
    getUserStickerSets,
    createStickerSet,
    addStickerToSet,
    getStickerSet,
    deleteStickerSet,
    generateStickerSetName
};