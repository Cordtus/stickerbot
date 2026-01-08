// stickerManager.js

import fs from 'fs';
import path from 'path';
import { 
  addStickerPack, 
  canUserEditPack as dbCanUserEditPack, 
  getStickerPackByName,
  addStickerToDatabase,
  getUserStickerPacks as dbGetUserStickerPacks,
  addExternalPack as dbaddExternalPack,
  updateStickerPackType
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
 * Detect sticker type from file path
 */
function detectStickerType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.webm') {
    return {
      isVideo: true,
      isAnimated: false,
      stickerType: 'video'
    };
  } else if (ext === '.tgs') {
    return {
      isVideo: false,
      isAnimated: true,
      stickerType: 'animated'
    };
  } else {
    return {
      isVideo: false,
      isAnimated: false,
      stickerType: 'static'
    };
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
      is_animated: pack.is_animated === 1,
      is_video: pack.is_video === 1,
      owner_id: pack.owner_id,
      sticker_type: pack.is_video ? 'video' : (pack.is_animated ? 'animated' : 'static')
    }));
  } catch (error) {
    logWithContext('getUserStickerSets', 'Error getting user sticker sets', error);
    return [];
  }
}

/**
 * create new sticker set
 */
async function createStickerSet(ctx, name, title, firstStickerPath = null, firstStickerEmoji = '😊', isVideo = false) {
  try {
    const userId = ctx.from.id;
    logWithContext('createStickerSet', `Creating sticker set "${name}" (${title}) for user ${userId}, isVideo: ${isVideo}`);
    
    // If we have a first sticker, add it during creation
    if (firstStickerPath) {
      // Check file exists
      if (!fs.existsSync(firstStickerPath)) {
        throw new Error(`Sticker file not found at path: ${firstStickerPath}`);
      }
      
      // Detect sticker type from file
      const stickerType = detectStickerType(firstStickerPath);
      logWithContext('createStickerSet', `Detected sticker type: ${stickerType.stickerType}`);
      
      // Log file stats
      const fileStats = fs.statSync(firstStickerPath);
      logWithContext('createStickerSet', `First sticker file: ${firstStickerPath}, size: ${fileStats.size} bytes, type: ${stickerType.stickerType}`);
      
      // Read sticker file
      const stickerFile = fs.readFileSync(firstStickerPath);
      
      // Prepare API parameters based on sticker type
      let apiParams = {
        user_id: userId,
        name: name,
        title: title,
        emojis: firstStickerEmoji
      };
      
      // Fset sticker file parameter based on file type
      if (stickerType.isVideo) {
        apiParams.webm_sticker = { source: stickerFile, filename: 'sticker.webm' };
        logWithContext('createStickerSet', 'Creating video sticker set');
      } else if (stickerType.isAnimated) {
        apiParams.tgs_sticker = { source: stickerFile, filename: 'sticker.tgs' };
        logWithContext('createStickerSet', 'Creating animated sticker set');
      } else {
        apiParams.png_sticker = { source: stickerFile, filename: 'sticker.webp' };
        logWithContext('createStickerSet', 'Creating static sticker set');
      }
      
      // Call Telegram API to create sticker set
      try {
        logWithContext('createStickerSet', `Calling Telegram API to create ${stickerType.stickerType} sticker set`);
        
        const result = await ctx.telegram.callApi('createNewStickerSet', apiParams);
        
        // Save to our database with correct type flags
        logWithContext('createStickerSet', `Sticker set created on Telegram, saving to database`);
        const packId = await addStickerPack(userId, name, title);
        
        // Update pack type in database
        await updateStickerPackType(packId, stickerType.isAnimated, stickerType.isVideo);
        
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
        } else if (telegramError.message.includes('STICKER_VIDEO_BIG')) {
          throw new Error('Video sticker file is too large. Maximum size is 256KB.');
        } else if (telegramError.message.includes('STICKER_VIDEO_NODURATION')) {
          throw new Error('Video sticker must have a valid duration.');
        } else if (telegramError.message.includes('STICKER_VIDEO_DIMENSIONS')) {
          // NEW: Handle video dimension error
          throw new Error('Video sticker dimensions are invalid. One dimension must be exactly 512 pixels, the other 512 or less. Please try processing the video again.');
        } else if (telegramError.message.includes('STICKER_PNG_DIMENSIONS')) {
          throw new Error('Sticker dimensions are invalid. One dimension must be exactly 512 pixels, the other 512 or less.');
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
async function addStickerToSet(ctx, setName, stickerPath, emoji = '😊', isVideo = false) {
  try {
    const userId = ctx.from.id;
    logWithContext('addStickerToSet', `Adding sticker to set "${setName}" for user ${userId}, isVideo: ${isVideo}`);
    
    // Ensure user can edit this pack
    if (!await canUserEditPack(ctx, setName)) {
      throw new Error("You don't have permission to edit this sticker pack.");
    }
    
    // Get existing pack info to validate type compatibility
    const existingPack = await getStickerPackByName(setName);
    if (!existingPack) {
      throw new Error('Sticker pack not found.');
    }
    
    // Check file exists
    if (!fs.existsSync(stickerPath)) {
      throw new Error(`Sticker file not found at path: ${stickerPath}`);
    }
    
    // Detect new sticker type
    const newStickerType = detectStickerType(stickerPath);
    
    // Validate type compatibility with existing pack
    const packIsVideo = existingPack.is_video === 1;
    const packIsAnimated = existingPack.is_animated === 1;
    
    if (packIsVideo && !newStickerType.isVideo) {
      throw new Error('Cannot add static/animated stickers to a video sticker pack.');
    } else if (packIsAnimated && !newStickerType.isAnimated) {
      throw new Error('Cannot add static/video stickers to an animated sticker pack.');
    } else if (!packIsVideo && !packIsAnimated && (newStickerType.isVideo || newStickerType.isAnimated)) {
      throw new Error('Cannot add video/animated stickers to a static sticker pack.');
    }
    
    // Log file stats
    const fileStats = fs.statSync(stickerPath);
    logWithContext('addStickerToSet', `Sticker file: ${stickerPath}, size: ${fileStats.size} bytes, type: ${newStickerType.stickerType}`);
    
    // Read sticker file
    const stickerFile = fs.readFileSync(stickerPath);
    
    // Prepare API parameters based on sticker type
    let apiParams = {
      user_id: userId,
      name: setName,
      emojis: emoji
    };
    
    // Set sticker file parameter based on type
    if (newStickerType.isVideo) {
      apiParams.webm_sticker = { source: stickerFile, filename: 'sticker.webm' };
      logWithContext('addStickerToSet', 'Adding video sticker');
    } else if (newStickerType.isAnimated) {
      apiParams.tgs_sticker = { source: stickerFile, filename: 'sticker.tgs' };
      logWithContext('addStickerToSet', 'Adding animated sticker');
    } else {
      apiParams.png_sticker = { source: stickerFile, filename: 'sticker.webp' };
      logWithContext('addStickerToSet', 'Adding static sticker');
    }
    
    // Add sticker to set - telegram side
    try {
      logWithContext('addStickerToSet', `Calling Telegram API to add ${newStickerType.stickerType} sticker to set`);
      
      const result = await ctx.telegram.callApi('addStickerToSet', apiParams);
      
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
      
      // Common error messages with more helpful descriptions
      if (telegramError.message.includes('STICKERSET_INVALID')) {
        throw new Error('Invalid sticker set. The set may not exist or you may not have permission to edit it.');
      } else if (telegramError.message.includes('STICKERS_TOO_MUCH')) {
        throw new Error('This sticker set has reached the maximum number of stickers. Create a new set.');
      } else if (telegramError.message.includes('STICKER_PNG_DIMENSIONS')) {
        throw new Error('The sticker dimensions are invalid. Stickers must be 512x512 pixels with proper transparent areas.');
      } else if (telegramError.message.includes('STICKER_VIDEO_BIG')) {
        throw new Error('Video sticker file is too large. Maximum size is 256KB.');
      } else if (telegramError.message.includes('STICKER_VIDEO_NODURATION')) {
        throw new Error('Video sticker must have a valid duration.');
      } else if (telegramError.message.includes('STICKER_VIDEO_DIMENSIONS')) {
        // NEW: Handle video dimension error
        throw new Error('Video sticker dimensions are invalid. One dimension must be exactly 512 pixels, the other 512 or less. The video may need to be reprocessed with correct dimensions.');
      } else if (telegramError.message.includes('STICKER_ANIMATED_UPGRADE_NEEDED')) {
        throw new Error('Cannot add animated stickers to this pack type.');
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
 * Generate sticker set name
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
async function addExternalPack(ctx, packName) {
  try {
    const userId = ctx.from.id;
    logWithContext('addExternalPack', `Adding external pack ${packName} for user ${userId}`);
    
    // Get pack info from Telegram to get the title and type
    let packTitle = packName;
    let isAnimated = false;
    let isVideo = false;
    
    try {
      const packInfo = await ctx.telegram.getStickerSet(packName);
      if (packInfo && packInfo.title) {
        packTitle = packInfo.title;
        isAnimated = packInfo.is_animated || false;
        isVideo = packInfo.is_video || false;
        logWithContext('addExternalPack', `Got pack info from Telegram: "${packTitle}", animated: ${isAnimated}, video: ${isVideo}`);
      }
    } catch (err) {
      logWithContext('addExternalPack', `Couldn't get info for external pack`, err);
    }
    
    // Add to database
    const packId = await dbaddExternalPack(userId, packName, packTitle);
    
    // Update pack type if we detected it
    if (isAnimated || isVideo) {
      await updateStickerPackType(packId, isAnimated, isVideo);
    }
    
    return true;
  } catch (error) {
    logWithContext('addExternalPack', `Error adding external sticker pack`, error);
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
  addExternalPack,
  detectStickerType
};