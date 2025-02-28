// stickerManager.js

import fs from 'fs';
import { 
  addStickerPack, 
  canUserEditPack as dbCanUserEditPack, 
  getStickerPackByName,
  addStickerToDatabase,
  getUserStickerPacks as dbGetUserStickerPacks,
  addExternalStickerPack as dbAddExternalStickerPack,
  initDatabase
} from './databaseManager.js';
import { logWithContext } from './logger.js';
import { isValidStickerSetName, sanitizeStickerSetName } from './utils.js';
import { safeDeleteFile } from './fileHandler.js';

/**
 * Get user's sticker sets from both Telegram and our database
 * @param {object} ctx - Telegram context
 * @returns {Promise<Array>} List of sticker sets
 */
async function getUserStickerSets(ctx) {
  try {
    const userId = ctx.from.id;
    
    // Get sticker sets from our database
    const dbSets = await dbGetUserStickerPacks(userId);
    logWithContext('stickerManager', `Retrieved ${dbSets.length} sticker sets for user ${userId}`);
    
    // Transform database results to match format used in the app
    return dbSets.map(pack => ({
      id: pack.id,
      name: pack.name,
      title: pack.title,
      can_edit: pack.can_edit === 1,
      is_favorite: pack.is_favorite === 1,
      owner_id: pack.owner_id,
      is_animated: pack.is_animated === 1,
      is_video: pack.is_video === 1
    }));
  } catch (error) {
    logWithContext('stickerManager', 'Error getting user sticker sets', error);
    return [];
  }
}

/**
 * Create a new sticker set
 * @param {object} ctx - Telegram context
 * @param {string} name - Sticker set name
 * @param {string} title - Sticker set title
 * @param {string} firstStickerPath - Path to first sticker image/animation
 * @param {string} firstStickerEmoji - Emoji for first sticker
 * @param {string} stickerType - Type of sticker ('static', 'animated', or 'video')
 * @returns {Promise<object>} Telegram API result
 */
async function createStickerSet(ctx, name, title, firstStickerPath = null, firstStickerEmoji = '😊', stickerType = 'static') {
  try {
    const userId = ctx.from.id;
    
    // Validate sticker set name
    if (!isValidStickerSetName(name)) {
      throw new Error('Invalid sticker set name. Only lowercase letters, numbers and underscores are allowed.');
    }
    
    logWithContext('stickerManager', `Creating ${stickerType} sticker set "${name}" (${title}) for user ${userId}`);
    
    // If we have a first sticker, add it during creation
    if (firstStickerPath) {
      // Check file exists
      if (!fs.existsSync(firstStickerPath)) {
        throw new Error(`Sticker file not found at path: ${firstStickerPath}`);
      }
      
      // Log file stats
      const fileStats = fs.statSync(firstStickerPath);
      logWithContext('stickerManager', `First sticker file: ${firstStickerPath}, size: ${fileStats.size} bytes, type: ${stickerType}`);
      
      // Create form data with sticker image
      const stickerFile = fs.readFileSync(firstStickerPath);
      
      try {
        logWithContext('stickerManager', `Calling Telegram API to create sticker set with first sticker`);
        
        // Create the API parameters based on sticker type
        const params = {
          user_id: userId,
          name: name,
          title: title,
          emojis: firstStickerEmoji
        };
        
        // Add the appropriate sticker parameter based on type
        switch (stickerType) {
          case 'animated':
            params.tgs_sticker = { source: stickerFile, filename: 'sticker.tgs' };
            break;
          case 'video':
            params.webm_sticker = { source: stickerFile, filename: 'sticker.webm' };
            break;
          case 'static':
          default:
            params.png_sticker = { source: stickerFile, filename: 'sticker.webp' };
        }
        
        // Use the direct method for creating the sticker set
        const result = await ctx.telegram.callApi('createNewStickerSet', params);
        
        // Save to our database
        logWithContext('stickerManager', `Sticker set created on Telegram, saving to database`);
        const packId = await addStickerPack(userId, name, title);
        
        // Update the is_animated or is_video flags in the database if needed
        if (stickerType === 'animated' || stickerType === 'video') {
          const db = await initDatabase();
          await db.run(
            `UPDATE sticker_packs SET 
             is_animated = ?, 
             is_video = ? 
             WHERE id = ?`,
            [
              stickerType === 'animated' ? 1 : 0,
              stickerType === 'video' ? 1 : 0,
              packId
            ]
          );
        }
        
        // Get the sticker's file_id from Telegram's response if possible
        try {
          const stickerSet = await ctx.telegram.getStickerSet(name);
          if (stickerSet && stickerSet.stickers && stickerSet.stickers.length > 0) {
            logWithContext('stickerManager', `Saving first sticker (${stickerSet.stickers[0].file_id}) to database`);
            await addStickerToDatabase(packId, stickerSet.stickers[0].file_id, firstStickerEmoji, 0, stickerType);
          }
        } catch (err) {
          logWithContext('stickerManager', `Couldn't get file_id for first sticker`, err);
        }
        
        // Clean up the temporary file
        safeDeleteFile(firstStickerPath, 'stickerManager');
        
        return result;
      } catch (telegramError) {
        // Detailed error logging for Telegram API errors
        logWithContext('stickerManager', `Telegram API error creating sticker set`, telegramError);
        
        // Better error messages for common issues
        if (telegramError.message.includes('STICKERSET_INVALID')) {
          throw new Error('Invalid sticker set name. The name may already be taken or contains invalid characters.');
        } else if (telegramError.message.includes('STICKERS_TOO_MUCH')) {
          throw new Error('You have created too many sticker sets. Remove some before creating new ones.');
        } else if (telegramError.message.includes('PEER_ID_INVALID')) {
          throw new Error('Unable to create a sticker set for this user. Please restart with /start and try again.');
        } else {
          throw telegramError;
        }
      }
    } else {
      // We should never reach here as we always require a first sticker
      throw new Error('First sticker is required to create a sticker set.');
    }
  } catch (error) {
    logWithContext('stickerManager', `Error creating sticker set`, error);
    throw new Error(`Failed to create sticker set: ${error.message}`);
  }
}

/**
 * Add sticker to existing set
 * @param {object} ctx - Telegram context
 * @param {string} setName - Sticker set name
 * @param {string} stickerPath - Path to sticker file
 * @param {string} emoji - Emoji for sticker
 * @param {string} stickerType - Type of sticker ('static', 'animated', or 'video')
 * @returns {Promise<object>} Telegram API result
 */
async function addStickerToSet(ctx, setName, stickerPath, emoji = '😊', stickerType = 'static') {
  try {
    const userId = ctx.from.id;
    logWithContext('stickerManager', `Adding ${stickerType} sticker to set "${setName}" for user ${userId}`);
    
    // Ensure user can edit this pack
    if (!await canUserEditPack(ctx, setName)) {
      throw new Error("You don't have permission to edit this sticker pack.");
    }
    
    // Check file exists
    if (!fs.existsSync(stickerPath)) {
      throw new Error(`Sticker file not found at path: ${stickerPath}`);
    }
    
    // Log file stats
    const fileStats = fs.statSync(stickerPath);
    logWithContext('stickerManager', `Sticker file: ${stickerPath}, size: ${fileStats.size} bytes`);
    
    // Read sticker file
    const stickerFile = fs.readFileSync(stickerPath);
    
    // Call Telegram API to add sticker to set
    try {
      logWithContext('stickerManager', `Calling Telegram API to add ${stickerType} sticker to set`);
      
      // Create the API parameters
      const params = {
        user_id: userId,
        name: setName,
        emojis: emoji
      };
      
      // Add the appropriate sticker parameter based on type
      switch (stickerType) {
        case 'animated':
          params.tgs_sticker = { source: stickerFile, filename: 'sticker.tgs' };
          break;
        case 'video':
          params.webm_sticker = { source: stickerFile, filename: 'sticker.webm' };
          break;
        case 'static':
        default:
          params.png_sticker = { source: stickerFile, filename: 'sticker.webp' };
      }
      
      // Use direct API call
      const result = await ctx.telegram.callApi('addStickerToSet', params);
      
      // Get the sticker's file_id from Telegram's response if possible
      try {
        const pack = await getStickerPackByName(setName);
        if (pack) {
          const stickerSet = await ctx.telegram.getStickerSet(setName);
          if (stickerSet && stickerSet.stickers) {
            // Get position for new sticker
            const position = stickerSet.stickers.length - 1;
            // Get file_id of the last sticker (the one we just added)
            const newSticker = stickerSet.stickers[position];
            
            if (newSticker) {
              logWithContext('stickerManager', `Saving new sticker (${newSticker.file_id}) to database at position ${position}`);
              await addStickerToDatabase(pack.id, newSticker.file_id, emoji, position, stickerType);
            }
          }
        }
      } catch (err) {
        logWithContext('stickerManager', `Couldn't get file_id for new sticker`, err);
      }
      
      // Clean up temporary file
      safeDeleteFile(stickerPath, 'stickerManager');
      
      return result;
    } catch (telegramError) {
      // Detailed error logging for Telegram API errors
      logWithContext('stickerManager', `Telegram API error adding sticker to set`, telegramError);
      
      // Better error messages for common issues
      if (telegramError.message.includes('STICKERSET_INVALID')) {
        throw new Error('Invalid sticker set. The set may not exist or you may not have permission to edit it.');
      } else if (telegramError.message.includes('STICKERS_TOO_MUCH')) {
        throw new Error('This sticker set has reached the maximum number of stickers. Create a new set.');
      } else if (telegramError.message.includes('STICKER_PNG_DIMENSIONS')) {
        throw new Error('The sticker dimensions are invalid. Stickers must be 512x512 pixels with proper transparent areas.');
      } else if (telegramError.message.includes('STICKER_TGS_INVALID')) {
        throw new Error('The animated sticker file is invalid. It must be in .tgs format and follow Telegram guidelines.');
      } else if (telegramError.message.includes('STICKER_VIDEO_INVALID')) {
        throw new Error('The video sticker file is invalid. It must be in WebM format with VP9 codec, max 3 seconds.');
      } else {
        throw telegramError;
      }
    }
  } catch (error) {
    logWithContext('stickerManager', `Error adding sticker to set`, error);
    throw new Error(`Failed to add sticker to set: ${error.message}`);
  }
}

/**
 * Delete a sticker from a set
 * @param {object} ctx - Telegram context
 * @param {string} stickerId - Sticker ID
 * @returns {Promise<object>} Telegram API result
 */
async function deleteStickerFromSet(ctx, stickerId) {
  try {
    logWithContext('stickerManager', `Deleting sticker: ${stickerId}`);
    const result = await ctx.telegram.deleteStickerFromSet(stickerId);
    
    // We could implement database deletion here, but since we don't have
    // a direct mapping from Telegram's sticker_id to our database ID,
    // this would require additional work to implement properly.
    
    return result;
  } catch (error) {
    logWithContext('stickerManager', `Error deleting sticker`, error);
    throw new Error(`Failed to delete sticker: ${error.message}`);
  }
}

/**
 * Set sticker position in set
 * @param {object} ctx - Telegram context
 * @param {string} stickerId - Sticker ID
 * @param {number} position - Position in set
 * @returns {Promise<object>} Telegram API result
 */
async function setStickerPosition(ctx, stickerId, position) {
  try {
    logWithContext('stickerManager', `Setting sticker ${stickerId} to position ${position}`);
    const result = await ctx.telegram.setStickerPositionInSet(stickerId, position);
    return result;
  } catch (error) {
    logWithContext('stickerManager', `Error setting sticker position`, error);
    throw new Error(`Failed to set sticker position: ${error.message}`);
  }
}

/**
 * Generate a valid sticker set name
 * @param {object} ctx - Telegram context
 * @param {string} title - Sticker set title
 * @returns {string} Valid sticker set name
 */
function generateStickerSetName(ctx, title) {
  // Remove non-alphanumeric characters and convert to lowercase
  const base = sanitizeStickerSetName(title);
  
  // Add bot username suffix as required by Telegram
  const botUsername = ctx.botInfo.username;
  const randomSuffix = Math.floor(Math.random() * 1000);
  
  const name = `${base}_${randomSuffix}_by_${botUsername}`;
  logWithContext('stickerManager', `Generated name "${name}" from title "${title}"`);
  
  return name;
}

/**
 * Get sticker set info
 * @param {object} ctx - Telegram context
 * @param {string} name - Sticker set name
 * @returns {Promise<object>} Sticker set info
 */
async function getStickerSet(ctx, name) {
  try {
    logWithContext('stickerManager', `Getting sticker set: ${name}`);
    const result = await ctx.telegram.getStickerSet(name);
    return result;
  } catch (error) {
    logWithContext('stickerManager', `Error getting sticker set`, error);
    return null;
  }
}

/**
 * Check if user can edit a sticker pack
 * @param {object} ctx - Telegram context
 * @param {string} packName - Sticker pack name
 * @returns {Promise<boolean>} Whether user can edit pack
 */
async function canUserEditPack(ctx, packName) {
  try {
    const userId = ctx.from.id;
    logWithContext('stickerManager', `Checking if user ${userId} can edit pack ${packName}`);
    return await dbCanUserEditPack(userId, packName);
  } catch (error) {
    logWithContext('stickerManager', `Error checking if user can edit pack`, error);
    return false;
  }
}

/**
 * Add external sticker pack for a user
 * @param {object} ctx - Telegram context
 * @param {string} packName - Sticker pack name
 * @returns {Promise<boolean>} Whether pack was added
 */
async function addExternalStickerPack(ctx, packName) {
  try {
    const userId = ctx.from.id;
    logWithContext('stickerManager', `Adding external pack ${packName} for user ${userId}`);
    
    // Get pack info from Telegram to get the title
    let packTitle = packName;
    let isAnimated = false;
    let isVideo = false;
    
    try {
      const packInfo = await ctx.telegram.getStickerSet(packName);
      if (packInfo) {
        if (packInfo.title) {
          packTitle = packInfo.title;
        }
        
        // Check if pack contains animated or video stickers
        if (packInfo.stickers && packInfo.stickers.length > 0) {
          isAnimated = packInfo.is_animated || false;
          isVideo = packInfo.is_video || false;
        }
        
        logWithContext('stickerManager', `Got info from Telegram: "${packTitle}", animated=${isAnimated}, video=${isVideo}`);
      }
    } catch (err) {
      logWithContext('stickerManager', `Couldn't get info for external pack`, err);
    }
    
    // Add to database with pack type info
    const packId = await dbAddExternalStickerPack(userId, packName, packTitle);
    
    // Update pack type if needed
    if (isAnimated || isVideo) {
      const db = await initDatabase();
      await db.run(
        `UPDATE sticker_packs SET is_animated = ?, is_video = ? WHERE id = ?`,
        [isAnimated ? 1 : 0, isVideo ? 1 : 0, packId]
      );
    }
    
    return true;
  } catch (error) {
    logWithContext('stickerManager', `Error adding external sticker pack`, error);
    throw new Error(`Failed to add external sticker pack: ${error.message}`);
  }
}

/**
 * Determine sticker type from Telegram sticker object
 * @param {object} sticker - Telegram sticker object
 * @returns {string} Sticker type ('static', 'animated', or 'video')
 */
function getStickerType(sticker) {
  if (sticker.is_animated) {
    return 'animated';
  } else if (sticker.is_video) {
    return 'video';
  } else {
    return 'static';
  }
}

export {
  getUserStickerSets,
  createStickerSet,
  addStickerToSet,
  deleteStickerFromSet,
  setStickerPosition,
  getStickerSet,
  generateStickerSetName,
  canUserEditPack,
  addExternalStickerPack,
  getStickerType
};