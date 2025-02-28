// databaseManager.js

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { logWithContext } from './logger.js';
import { getDataPath, ensureDirectory, generateRandomId } from './utils.js';

// Define the database path
const dbPath = getDataPath('stickerpacks.db');

// Database connection
let db = null;

/**
 * Initialize the database
 * @returns {Promise<object>} Database connection object
 */
async function initDatabase() {
  if (db) return db;
  
  logWithContext('databaseManager', `Initializing database at ${dbPath}`);
  
  try {
    // Open database connection
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    
    // Enable foreign keys
    await db.exec('PRAGMA foreign_keys = ON');
    
    // Create tables if they don't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS sticker_packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        is_animated BOOLEAN DEFAULT 0,
        is_video BOOLEAN DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(user_id)
      );
      
      CREATE TABLE IF NOT EXISTS stickers (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        file_id TEXT,
        emoji TEXT DEFAULT '😊',
        position INTEGER,
        type TEXT DEFAULT 'static', /* 'static', 'animated', 'video' */
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS user_packs (
        user_id INTEGER NOT NULL,
        pack_id TEXT NOT NULL,
        can_edit BOOLEAN DEFAULT 0,
        is_favorite BOOLEAN DEFAULT 0,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pack_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
      );
    `);
    
    // Check and add new column to stickers table if it doesn't exist
    const columns = await db.all("PRAGMA table_info(stickers)");
    if (!columns.some(col => col.name === 'type')) {
      logWithContext('databaseManager', 'Adding type column to stickers table');
      await db.exec('ALTER TABLE stickers ADD COLUMN type TEXT DEFAULT "static"');
    }
    
    logWithContext('databaseManager', 'Database initialized successfully');
    return db;
  } catch (err) {
    logWithContext('databaseManager', 'Database initialization error', err);
    throw err;
  }
}

/**
 * Execute a database operation within a transaction
 * @param {Function} operation - Async function that performs database operations
 * @param {string} context - Context identifier for logging
 * @returns {Promise<any>} The result of the operation
 */
async function withTransaction(operation, context = 'dbTransaction') {
  const db = await initDatabase();
  let result = null;
  
  try {
    logWithContext(context, `Starting transaction`);
    await db.exec('BEGIN TRANSACTION');
    
    result = await operation(db);
    
    logWithContext(context, `Committing transaction`);
    await db.exec('COMMIT');
    return result;
  } catch (err) {
    logWithContext(context, `Transaction failed, rolling back`, err);
    try {
      await db.exec('ROLLBACK');
    } catch (rollbackErr) {
      logWithContext(context, `Rollback failed`, rollbackErr);
    }
    throw err;
  }
}

/**
 * Batch database operations for better performance
 * @param {Array} items - Array of items to process 
 * @param {Function} operation - Function that returns a SQL operation for each item
 * @param {string} context - Context identifier for logging
 * @returns {Promise<Array>} Array of results
 */
async function batchOperation(items, operation, context = 'dbTransaction') {
  if (!items || items.length === 0) return [];
  
  const db = await initDatabase();
  const results = [];
  
  try {
    logWithContext(context, `Starting batch operation for ${items.length} items`);
    await db.exec('BEGIN TRANSACTION');
    
    for (const item of items) {
      const { sql, params } = operation(item);
      const result = await db.run(sql, params);
      results.push(result);
    }
    
    logWithContext(context, `Committing batch operation`);
    await db.exec('COMMIT');
    return results;
  } catch (err) {
    logWithContext(context, `Batch operation failed, rolling back`, err);
    try {
      await db.exec('ROLLBACK');
    } catch (rollbackErr) {
      logWithContext(context, `Rollback failed`, rollbackErr);
    }
    throw err;
  }
}

/**
 * Get or create user in the database
 * @param {object} ctx - Telegram context
 * @returns {Promise<object>} User object
 */
async function getOrCreateUser(ctx) {
  const user = ctx.from;
  
  if (!user) {
    throw new Error('User information not available');
  }
  
  return withTransaction(async (db) => {
    // Try to get existing user
    const existingUser = await db.get('SELECT * FROM users WHERE user_id = ?', user.id);
    
    if (existingUser) {
      return existingUser;
    }
    
    // Create new user if not exists
    await db.run(
      'INSERT INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)',
      [user.id, user.username, user.first_name, user.last_name]
    );
    
    logWithContext('databaseManager', `Created new user ${user.id} (${user.username || 'no username'})`);
    return await db.get('SELECT * FROM users WHERE user_id = ?', user.id);
  }, 'databaseManager');
}

/**
 * Add a sticker pack to the database
 * @param {number} userId - User ID of the owner
 * @param {string} packName - Unique sticker pack name
 * @param {string} packTitle - User-friendly title for the pack
 * @param {boolean} canEdit - Whether the user can edit this pack
 * @returns {Promise<string>} - ID of the sticker pack
 */
async function addStickerPack(userId, packName, packTitle, canEdit = true) {
  return withTransaction(async (db) => {
    // Check if user exists, if not create them
    const user = await db.get('SELECT * FROM users WHERE user_id = ?', userId);
    if (!user) {
      await db.run('INSERT INTO users (user_id) VALUES (?)', userId);
    }
    
    // Check if pack already exists
    const existingPack = await db.get('SELECT * FROM sticker_packs WHERE name = ?', packName);
    
    if (existingPack) {
      // Update the relationship if needed
      const userPack = await db.get(
        'SELECT * FROM user_packs WHERE user_id = ? AND pack_id = ?',
        [userId, existingPack.id]
      );
      
      if (!userPack) {
        await db.run(
          'INSERT INTO user_packs (user_id, pack_id, can_edit) VALUES (?, ?, ?)',
          [userId, existingPack.id, canEdit ? 1 : 0]
        );
      }
      
      return existingPack.id;
    }
    
    // Generate non-sequential ID
    const packId = generateRandomId('pack_');
    
    // Create new pack
    await db.run(
      'INSERT INTO sticker_packs (id, name, title, owner_id) VALUES (?, ?, ?, ?)',
      [packId, packName, packTitle, userId]
    );
    
    // Create user-pack relationship
    await db.run(
      'INSERT INTO user_packs (user_id, pack_id, can_edit) VALUES (?, ?, ?)',
      [userId, packId, canEdit ? 1 : 0]
    );
    
    logWithContext('databaseManager', `Created new sticker pack '${packTitle}' with ID ${packId}`);
    return packId;
  }, 'databaseManager');
}

/**
 * Get user's sticker packs
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of sticker packs
 */
async function getUserStickerPacks(userId) {
  const db = await initDatabase();
  
  try {
    return await db.all(`
      SELECT p.*, up.can_edit, up.is_favorite
      FROM sticker_packs p
      JOIN user_packs up ON p.id = up.pack_id
      WHERE up.user_id = ?
      ORDER BY up.is_favorite DESC, p.last_modified DESC
    `, userId);
  } catch (err) {
    logWithContext('databaseManager', 'Error getting user sticker packs', err);
    return [];
  }
}

/**
 * Get sticker pack by name
 * @param {string} packName - Sticker pack name
 * @returns {Promise<object|null>} Sticker pack or null if not found
 */
async function getStickerPackByName(packName) {
  const db = await initDatabase();
  
  try {
    return await db.get('SELECT * FROM sticker_packs WHERE name = ?', packName);
  } catch (err) {
    logWithContext('databaseManager', 'Error getting sticker pack', err);
    return null;
  }
}

/**
 * Check if user can edit a sticker pack
 * @param {number} userId - User ID
 * @param {string} packName - Sticker pack name
 * @returns {Promise<boolean>} Whether user can edit pack
 */
async function canUserEditPack(userId, packName) {
  const db = await initDatabase();
  
  try {
    const pack = await getStickerPackByName(packName);
    if (!pack) return false;
    
    const userPack = await db.get(`
      SELECT * FROM user_packs
      WHERE user_id = ? AND pack_id = ?
    `, [userId, pack.id]);
    
    return userPack?.can_edit === 1 || pack.owner_id === userId;
  } catch (err) {
    logWithContext('databaseManager', 'Error checking if user can edit pack', err);
    return false;
  }
}

/**
 * Add external sticker pack to user's collection
 * @param {number} userId - User ID
 * @param {string} packName - Sticker pack name
 * @param {string} packTitle - Sticker pack title (or name if not provided)
 * @returns {Promise<string>} Pack ID
 */
async function addExternalStickerPack(userId, packName, packTitle) {
  return await addStickerPack(userId, packName, packTitle || packName, false);
}

/**
 * Add sticker to database
 * @param {string} packId - ID of the sticker pack
 * @param {string} fileId - Telegram file ID for the sticker
 * @param {string} emoji - Emoji associated with the sticker
 * @param {number} position - Position in the sticker pack
 * @param {string} type - Sticker type ('static', 'animated', or 'video')
 * @returns {Promise<string>} - ID of the new sticker
 */
async function addStickerToDatabase(packId, fileId, emoji = '😊', position = 0, type = 'static') {
  return withTransaction(async (db) => {
    // Generate non-sequential ID
    const stickerId = generateRandomId('sticker_');
    
    await db.run(
      'INSERT INTO stickers (id, pack_id, file_id, emoji, position, type) VALUES (?, ?, ?, ?, ?, ?)',
      [stickerId, packId, fileId, emoji, position, type]
    );
    
    // Update last modified timestamp
    await db.run(
      'UPDATE sticker_packs SET last_modified = CURRENT_TIMESTAMP WHERE id = ?',
      packId
    );
    
    logWithContext('databaseManager', `Added ${type} sticker to pack ${packId} at position ${position}`);
    return stickerId;
  }, 'databaseManager');
}

/**
 * Get stickers in a pack
 * @param {string} packId - Sticker pack ID
 * @returns {Promise<Array>} List of stickers
 */
async function getStickersInPack(packId) {
  const db = await initDatabase();
  
  try {
    return await db.all(`
      SELECT * FROM stickers
      WHERE pack_id = ?
      ORDER BY position
    `, packId);
  } catch (err) {
    logWithContext('databaseManager', 'Error getting stickers in pack', err);
    return [];
  }
}

/**
 * Toggle favorite status of a pack
 * @param {number} userId - User ID
 * @param {string} packId - Sticker pack ID
 * @returns {Promise<boolean>} New favorite status
 */
async function toggleFavoritePack(userId, packId) {
  return withTransaction(async (db) => {
    const userPack = await db.get(
      'SELECT * FROM user_packs WHERE user_id = ? AND pack_id = ?',
      [userId, packId]
    );
    
    if (!userPack) {
      throw new Error('User does not have access to this pack');
    }
    
    const newFavoriteStatus = userPack.is_favorite === 1 ? 0 : 1;
    
    await db.run(
      'UPDATE user_packs SET is_favorite = ? WHERE user_id = ? AND pack_id = ?',
      [newFavoriteStatus, userId, packId]
    );
    
    logWithContext('databaseManager', `User ${userId} ${newFavoriteStatus ? 'favorited' : 'unfavorited'} pack ${packId}`);
    return newFavoriteStatus === 1;
  }, 'databaseManager');
}

/**
 * Remove user's access to a pack
 * @param {number} userId - User ID
 * @param {string} packId - Sticker pack ID
 * @returns {Promise<boolean>} Success status
 */
async function removeUserPack(userId, packId) {
  return withTransaction(async (db) => {
    await db.run(
      'DELETE FROM user_packs WHERE user_id = ? AND pack_id = ?',
      [userId, packId]
    );
    
    // If no users have access to this pack and it's not owned by anyone, delete it
    const packUsers = await db.get(
      'SELECT COUNT(*) as count FROM user_packs WHERE pack_id = ?',
      packId
    );
    
    if (packUsers.count === 0) {
      const pack = await db.get('SELECT * FROM sticker_packs WHERE id = ?', packId);
      
      if (!pack || pack.owner_id === userId) {
        await db.run('DELETE FROM sticker_packs WHERE id = ?', packId);
        logWithContext('databaseManager', `Deleted sticker pack ${packId}`);
      }
    }
    
    logWithContext('databaseManager', `Removed user ${userId} from pack ${packId}`);
    return true;
  }, 'databaseManager');
}

/**
 * Get pack stats
 * @returns {Promise<object>} Statistics about packs, stickers, and users
 */
async function getPackStats() {
  const db = await initDatabase();
  
  try {
    const stats = {};
    
    stats.totalPacks = (await db.get('SELECT COUNT(*) as count FROM sticker_packs')).count;
    stats.totalStickers = (await db.get('SELECT COUNT(*) as count FROM stickers')).count;
    stats.totalUsers = (await db.get('SELECT COUNT(*) as count FROM users')).count;
    
    return stats;
  } catch (err) {
    logWithContext('databaseManager', 'Error getting pack stats', err);
    return {
      totalPacks: 0,
      totalStickers: 0,
      totalUsers: 0
    };
  }
}

// Export all database functions
export {
  initDatabase,
  withTransaction,
  batchOperation,
  getOrCreateUser,
  addStickerPack,
  getUserStickerPacks,
  getStickerPackByName,
  canUserEditPack,
  addExternalStickerPack,
  addStickerToDatabase,
  getStickersInPack,
  toggleFavoritePack,
  removeUserPack,
  getPackStats
};