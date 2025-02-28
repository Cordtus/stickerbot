// stickerManager.js

import fs from 'fs';
import { 
  addStickerPack, 
  canUserEditPack as dbCanUserEditPack, 
  getStickerPackByName,
  addStickerToDatabase,
  getUserStickerPacks as dbGetUserStickerPacks,
  addExternalStickerPack as dbAddExternalStickerPack
} from './databaseManager.js';

// Enhanced logger
function logWithContext(context, message, error = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${context}] ${message}`);
  if (error) {
      console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
      console.error(error.stack);
  }
}

/**
 * Get user's sticker sets from both Telegram and our database
 */
async function getUserStickerSets(ctx) {
  try {
    const userId = ctx.from.id;
    
    // Get sticker sets from our database
    const dbSets = await dbGetUserStickerPacks(userId);
    logWithContext('getUserStickerSets', `Retrieved ${dbSets.length} sticker sets for user ${userId}`);
    
    // Transform database results to match format used in the app
    return dbSets.map(pack => ({
      id: pack.id,
      name: pack.name,
      title: pack.title,
      can_edit: pack.can_edit === 1,
      is_favorite: pack.is_favorite === 1,
      owner_id: pack.owner_id
    }));
  } catch (error) {
    logWithContext('getUserStickerSets', 'Error getting user sticker sets', error);
    return [];
  }
}

/**
 * Create a new sticker set
 */
async function createStickerSet(ctx, name, title, firstStickerPath = null, firstStickerEmoji = '😊') {
  try {
    const userId = ctx.from.id;
    logWithContext('createStickerSet', `Creating sticker set "${name}" (${title}) for user ${userId}`);
    
    // If we have a first sticker, add it during creation
    if (firstStickerPath) {
      // Check file exists
      if (!fs.existsSync(firstStickerPath)) {
        throw new Error(`Sticker file not found at path: ${firstStickerPath}`);
      }
      
      // Log file stats
      const fileStats = fs.statSync(firstStickerPath);
      logWithContext('createStickerSet', `First sticker file: ${firstStickerPath}, size: ${fileStats.size} bytes`);
      
      // Create form data with sticker image
      const stickerFile = fs.readFileSync(firstStickerPath);
      
      // Call Telegram API to create sticker set with first sticker
      try {
        logWithContext('createStickerSet', `Calling Telegram API to create sticker set with first sticker`);
        const result = await ctx.telegram.createNewStickerSet(
          userId,
          name,
          title,
          {
            source: stickerFile,
            filename: `sticker.webp`
          },
          firstStickerEmoji
        );
        
        // Save to our database
        logWithContext('createStickerSet', `Sticker set created on Telegram, saving to database`);
        const packId = await addStickerPack(userId, name, title);
        
        // Get the sticker's file_id from Telegram's response if possible
        try {
          const stickerSet = await ctx.telegram.getStickerSet(name);
          if (stickerSet && stickerSet.stickers && stickerSet.stickers.length > 0) {
            logWithContext('createStickerSet', `Saving first sticker (${stickerSet.stickers[0].file_id}) to database`);
            await addStickerToDatabase(packId, stickerSet.stickers[0].file_id, firstStickerEmoji, 0);
          }
        } catch (err) {
          logWithContext('createStickerSet', `Couldn't get file_id for first sticker`, err);
        }
        
        return result;
      } catch (telegramError) {
        // Detailed error logging for Telegram API errors
        logWithContext('createStickerSet', `Telegram API error creating sticker set`, telegramError);
        
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
    logWithContext('createStickerSet', `Error creating sticker set`, error);
    throw new Error(`Failed to create sticker set: ${error.message}`);
  }
}

/**
 * Add sticker to existing set
 */
async function addStickerToSet(ctx, setName, stickerPath, emoji = '😊') {
  try {
    const userId = ctx.from.id;
    logWithContext('addStickerToSet', `Adding sticker to set "${setName}" for user ${userId}`);
    
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
    logWithContext('addStickerToSet', `Sticker file: ${stickerPath}, size: ${fileStats.size} bytes`);
    
    // Read sticker file
    const stickerFile = fs.readFileSync(stickerPath);
    
    // Call Telegram API to add sticker to set
    try {
      logWithContext('addStickerToSet', `Calling Telegram API to add sticker to set`);
      const result = await ctx.telegram.addStickerToSet(
        userId,
        setName,
        {
          source: stickerFile,
          filename: `sticker.webp`
        },
        emoji
      );
      
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
              logWithContext('addStickerToSet', `Saving new sticker (${newSticker.file_id}) to database at position ${position}`);
              await addStickerToDatabase(pack.id, newSticker.file_id, emoji, position);
            }
          }
        }
      } catch (err) {
        logWithContext('addStickerToSet', `Couldn't get file_id for new sticker`, err);
      }
      
      return result;
    } catch (telegramError) {
      // Detailed error logging for Telegram API errors
      logWithContext('addStickerToSet', `Telegram API error adding sticker to set`, telegramError);
      
      // Better error messages for common issues
      if (telegramError.message.includes('STICKERSET_INVALID')) {
        throw new Error('Invalid sticker set. The set may not exist or you may not have permission to edit it.');
      } else if (telegramError.message.includes('STICKERS_TOO_MUCH')) {
        throw new Error('This sticker set has reached the maximum number of stickers. Create a new set.');
      } else if (telegramError.message.includes('STICKER_PNG_DIMENSIONS')) {
        throw new Error('The sticker dimensions are invalid. Stickers must be 512x512 pixels with proper transparent areas.');
      } else {
        throw telegramError;
      }
    }
  } catch (error) {
    logWithContext('addStickerToSet', `Error adding sticker to set`, error);
    throw new Error(`Failed to add sticker to set: ${error.message}`);
  }
}

/**
 * Delete a sticker from a set
 */
async function deleteStickerFromSet(ctx, stickerId) {
  try {
    logWithContext('deleteStickerFromSet', `Deleting sticker: ${stickerId}`);
    const result = await ctx.telegram.deleteStickerFromSet(stickerId);
    
    // We could implement database deletion here, but since we don't have
    // a direct mapping from Telegram's sticker_id to our database ID,
    // this would require additional work to implement properly.
    
    return result;
  } catch (error) {
    logWithContext('deleteStickerFromSet', `Error deleting sticker`, error);
    throw new Error(`Failed to delete sticker: ${error.message}`);
  }
}

/**
 * Set sticker position in set
 */
async function setStickerPosition(ctx, stickerId, position) {
  try {
    logWithContext('setStickerPosition', `Setting sticker ${stickerId} to position ${position}`);
    const result = await ctx.telegram.setStickerPositionInSet(stickerId, position);
    return result;
  } catch (error) {
    logWithContext('setStickerPosition', `Error setting sticker position`, error);
    throw new Error(`Failed to set sticker position: ${error.message}`);
  }
}

/**
 * Generate a valid sticker set name
 */
function generateStickerSetName(ctx, title) {
  // Remove non-alphanumeric characters and convert to lowercase
  const base = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Add bot username suffix as required by Telegram
  const botUsername = ctx.botInfo.username;
  const randomSuffix = Math.floor(Math.random() * 1000);
  
  const name = `${base}_${randomSuffix}_by_${botUsername}`;
  logWithContext('generateStickerSetName', `Generated name "${name}" from title "${title}"`);
  
  return name;
}

/**
 * Get sticker set info
 */
async function getStickerSet(ctx, name) {
  try {
    logWithContext('getStickerSet', `Getting sticker set: ${name}`);
    const result = await ctx.telegram.getStickerSet(name);
    return result;
  } catch (error) {
    logWithContext('getStickerSet', `Error getting sticker set`, error);
    return null;
  }
}

/**
 * Check if user can edit a sticker pack
 */
async function canUserEditPack(ctx, packName) {
  try {
    const userId = ctx.from.id;
    logWithContext('canUserEditPack', `Checking if user ${userId} can edit pack ${packName}`);
    return await dbCanUserEditPack(userId, packName);
  } catch (error) {
    logWithContext('canUserEditPack', `Error checking if user can edit pack`, error);
    return false;
  }
}

/**
 * Add external sticker pack for a user
 */
async function addExternalStickerPack(ctx, packName) {
  try {
    const userId = ctx.from.id;
    logWithContext('addExternalStickerPack', `Adding external pack ${packName} for user ${userId}`);
    
    // Get pack info from Telegram to get the title
    let packTitle = packName;
    try {
      const packInfo = await ctx.telegram.getStickerSet(packName);
      if (packInfo && packInfo.title) {
        packTitle = packInfo.title;
        logWithContext('addExternalStickerPack', `Got title from Telegram: "${packTitle}"`);
      }
    } catch (err) {
      logWithContext('addExternalStickerPack', `Couldn't get info for external pack`, err);
    }
    
    await dbAddExternalStickerPack(userId, packName, packTitle);
    return true;
  } catch (error) {
    logWithContext('addExternalStickerPack', `Error adding external sticker pack`, error);
    throw new Error(`Failed to add external sticker pack: ${error.message}`);
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
  addExternalStickerPack
};