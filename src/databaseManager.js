// databaseManager.js

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name correctly in ES module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'stickerpacks.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Database connection
let db = null;

/**
 * Initialize the database
 */
async function initDatabase() {
  if (db) return db;
  
  console.log(`Initializing database at ${dbPath}`);
  
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pack_id INTEGER NOT NULL,
        file_id TEXT,
        emoji TEXT DEFAULT '😊',
        position INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS user_packs (
        user_id INTEGER NOT NULL,
        pack_id INTEGER NOT NULL,
        can_edit BOOLEAN DEFAULT 0,
        is_favorite BOOLEAN DEFAULT 0,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pack_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
      );
    `);
    
    console.log('Database initialized successfully');
    return db;
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err;
  }
}

/**
 * Get or create user in the database
 */
async function getOrCreateUser(ctx) {
  const db = await initDatabase();
  const user = ctx.from;
  
  if (!user) {
    throw new Error('User information not available');
  }
  
  try {
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
    
    return await db.get('SELECT * FROM users WHERE user_id = ?', user.id);
  } catch (err) {
    console.error('Error getting or creating user:', err);
    throw err;
  }
}

/**
 * Add a sticker pack to the database
 */
async function addStickerPack(userId, packName, packTitle, canEdit = true) {
  const db = await initDatabase();
  
  try {
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
    
    // Create new pack
    const result = await db.run(
      'INSERT INTO sticker_packs (name, title, owner_id) VALUES (?, ?, ?)',
      [packName, packTitle, userId]
    );
    
    const packId = result.lastID;
    
    // Create user-pack relationship
    await db.run(
      'INSERT INTO user_packs (user_id, pack_id, can_edit) VALUES (?, ?, ?)',
      [userId, packId, canEdit ? 1 : 0]
    );
    
    return packId;
  } catch (err) {
    console.error('Error adding sticker pack:', err);
    throw err;
  }
}

/**
 * Get user's sticker packs
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
    console.error('Error getting user sticker packs:', err);
    return [];
  }
}

/**
 * Get sticker pack by name
 */
async function getStickerPackByName(packName) {
  const db = await initDatabase();
  
  try {
    return await db.get('SELECT * FROM sticker_packs WHERE name = ?', packName);
  } catch (err) {
    console.error('Error getting sticker pack:', err);
    return null;
  }
}

/**
 * Check if user can edit a sticker pack
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
    console.error('Error checking if user can edit pack:', err);
    return false;
  }
}

/**
 * Add external sticker pack to user's collection
 */
async function addExternalStickerPack(userId, packName, packTitle) {
  return await addStickerPack(userId, packName, packTitle || packName, false);
}

/**
 * Add sticker to database
 */
async function addStickerToDatabase(packId, fileId, emoji = '😊', position = 0) {
  const db = await initDatabase();
  
  try {
    const result = await db.run(
      'INSERT INTO stickers (pack_id, file_id, emoji, position) VALUES (?, ?, ?, ?)',
      [packId, fileId, emoji, position]
    );
    
    // Update last modified timestamp
    await db.run(
      'UPDATE sticker_packs SET last_modified = CURRENT_TIMESTAMP WHERE id = ?',
      packId
    );
    
    return result.lastID;
  } catch (err) {
    console.error('Error adding sticker to database:', err);
    throw err;
  }
}

/**
 * Get stickers in a pack
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
    console.error('Error getting stickers in pack:', err);
    return [];
  }
}

/**
 * Toggle favorite status of a pack
 */
async function toggleFavoritePack(userId, packId) {
  const db = await initDatabase();
  
  try {
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
    
    return newFavoriteStatus === 1;
  } catch (err) {
    console.error('Error toggling favorite pack:', err);
    throw err;
  }
}

/**
 * Remove user's access to a pack
 */
async function removeUserPack(userId, packId) {
  const db = await initDatabase();
  
  try {
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
      }
    }
    
    return true;
  } catch (err) {
    console.error('Error removing user pack:', err);
    throw err;
  }
}

/**
 * Get pack stats
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
    console.error('Error getting pack stats:', err);
    return {
      totalPacks: 0,
      totalStickers: 0,
      totalUsers: 0
    };
  }
}

export {
  initDatabase,
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