// messageHandlers.js

import fs from 'fs';
import axios from 'axios';
import sharp from 'sharp';
import { getSession } from './sessionManager.js';
import { 
    processImages, 
    processStickerMessage, 
    processImageToFile, 
    processWebpForSticker 
} from './imageProcessor.js';
import { 
    addStickerToSet, 
    createStickerSet, 
    generateStickerSetName,
    addExternalStickerPack,
    canUserEditPack,
    getStickerType
} from './stickerManager.js';
import { tempDir, getTempPath, extractStickerSetName, generateUniqueFilename } from './utils.js';
import { logWithContext } from './logger.js';
import { safeDeleteFile, createTempFileFromBuffer } from './fileHandler.js';
import { processAnimatedSticker } from './animationProcessor.js';

// Handle photos and documents
async function handlePhotoDocument(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handlePhotoDocument', `Started with mode=${session.mode}, step=${session.packCreationStep}`);

    // Require mode selection first
    if (!session.mode) {
        await ctx.reply('Please select a mode first using /start.');
        return;
    }
    
    // PRIORITY #1: Special handling for sticker pack mode
    if (session.mode === 'packs' && 
        (session.packCreationStep === 'adding_stickers' || 
         session.packCreationStep === 'waiting_first_sticker')) {
        logWithContext('handlePhotoDocument', `Redirecting to sticker pack handler - packName=${session.currentPackName}`);
        await handleStickerForPack(ctx);
        return;
    }

    // Extract files to process
    let files = [];
    
    // PRIORITY #2: Special case fix: WebP in icon mode
    if (ctx.message.document && 
        ctx.message.document.mime_type === 'image/webp' && 
        session.mode === 'icon') {
        
        await ctx.reply('Processing your WebP image, please wait...');
        
        try {
            // Get file details
            const fileId = ctx.message.document.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            
            // Download and process directly
            const response = await axios({
                url: fileLink,
                responseType: 'arraybuffer'
            });
            
            const buffer = Buffer.from(response.data);
            
            // Force resize to 100x100 for icon mode
            const processedBuffer = await sharp(buffer)
                .resize(100, 100, {
                    fit: sharp.fit.cover,
                    withoutEnlargement: false  // Force resize regardless of original size
                })
                .webp({ lossless: true })
                .toBuffer();
                
            // Save and send
            const userId = ctx.from.id;
            const filename = generateUniqueFilename('icon', 'webp', userId);
            const filePath = getTempPath(filename);
            
            fs.writeFileSync(filePath, processedBuffer);
            
            await ctx.replyWithDocument({
                source: filePath,
                filename: filename
            });
            
            // Clean up
            safeDeleteFile(filePath, 'handlePhotoDocument');
            
            await ctx.reply('WebP processing complete!', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                        [{ text: 'Convert More Images', callback_data: 'convert_more' }]
                    ]
                }
            });
            
            return;
        } catch (err) {
            logWithContext('handlePhotoDocument', 'Error processing WebP in icon mode', err);
            await ctx.reply(`Error: ${err.message}`);
            return;
        }
    }
    
    // PRIORITY #3: Standard processing for all other cases
    if (ctx.message.photo && ctx.message.photo.length > 0) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        files.push({ fileId: photo.file_id, fileSize: photo.file_size });
        logWithContext('handlePhotoDocument', `Processing photo with fileId=${photo.file_id}`);
    } else if (ctx.message.document) {
        const doc = ctx.message.document;
        files.push({ fileId: doc.file_id, fileName: doc.file_name, fileSize: doc.file_size });
        logWithContext('handlePhotoDocument', `Processing document with fileId=${doc.file_id}, fileName=${doc.file_name}`);
    }

    if (files.length === 0) {
        await ctx.reply('No valid files were found in your message. Please send an image.');
        return;
    }

    // Indicate processing has started
    await ctx.reply('Processing your image(s), please wait...');
    session.images = files;

    try {
        const results = await processImages(ctx, session.images, 
            session.mode === 'icon' 
                ? { width: 100, height: 100, forceResize: true } 
                : { width: 512, height: 462, addBuffer: true }
        );

        // Handle results
        if (results.success.length > 0) {
            await ctx.reply(`Successfully processed ${results.success.length} image(s).`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                        [{ text: 'Convert More Images', callback_data: 'convert_more' }]
                    ]
                }
            });
        }

        if (results.failures.length > 0) {
            await ctx.reply(`Failed to process ${results.failures.length} image(s). Please try again.`);
        }
    } catch (err) {
        logWithContext('handlePhotoDocument', 'Error during image processing', err);
        await ctx.reply(`An error occurred: ${err.message}`);
    }
}

// Handle stickers
async function handleSticker(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleSticker', `Started with mode=${session.mode}, step=${session.packCreationStep}`);

    // Get sticker type 
    const sticker = ctx.message.sticker;
    const isAnimated = sticker.is_animated;
    const isVideo = sticker.is_video;
    const stickerType = isAnimated ? 'animated' : (isVideo ? 'video' : 'static');
    
    logWithContext('handleSticker', `Sticker type: ${stickerType}`);

    // PRIORITY #1: Check if we're in sticker pack creation or editing mode
    if (session.mode === 'packs' && 
        (session.packCreationStep === 'adding_stickers' || 
         session.packCreationStep === 'waiting_first_sticker')) {
        logWithContext('handleSticker', `Handling sticker for pack creation/editing - packName=${session.currentPackName}`);
        await handleStickerForPack(ctx);
        return;
    }

    // PRIORITY #2: Handle forwarded sticker for external pack addition
    if (session.mode === 'packs' && session.packCreationStep === 'awaiting_external_pack') {
        try {
            // Extract pack info from sticker
            if (!ctx.message.sticker.set_name) {
                return ctx.reply('This sticker doesn\'t belong to a pack. Please forward a sticker from a pack or send a pack link.');
            }
            
            const packName = ctx.message.sticker.set_name;
            logWithContext('handleSticker', `Processing external pack: ${packName}`);
            
            // Add to user's collection
            await addExternalStickerPack(ctx, packName);
            
            // Check if user can edit this pack
            const canEdit = await canUserEditPack(ctx, packName);
            
            if (canEdit) {
                session.currentPackName = packName;
                session.packCreationStep = 'adding_stickers';
                
                return ctx.reply(`Pack "${packName}" added to your collection! You can add stickers to this pack.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'Add Stickers', callback_data: `select_pack:${packName}`}],
                            [{text: 'View Pack', url: `https://t.me/addstickers/${packName}`}],
                            [{text: 'Return to Pack Management', callback_data: 'select_packs'}]
                        ]
                    }
                });
            } else {
                session.packCreationStep = null;
                return ctx.reply(`Pack "${packName}" added to your collection for reference, but you don't have permission to edit it. Only packs created by you with this bot can be edited.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'View Pack', url: `https://t.me/addstickers/${packName}`}],
                            [{text: 'Return to Pack Management', callback_data: 'select_packs'}]
                        ]
                    }
                });
            }
        } catch (error) {
            logWithContext('handleSticker', 'Error processing external pack', error);
            session.packCreationStep = null;
            return ctx.reply(`Error: ${error.message}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{text: 'Try Again', callback_data: 'add_external_pack'}],
                        [{text: 'Return to Pack Management', callback_data: 'select_packs'}]
                    ]
                }
            });
        }
    }
    
    // Handle animated/video stickers
    if (isAnimated || isVideo) {
        return ctx.reply(`This is a ${isAnimated ? 'animated' : 'video'} sticker. Currently, the converter only supports static stickers.
The bot can still be used to manage packs containing animated and video stickers.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                ]
            }
        });
    }
    
    try {
        // PRIORITY #3: Check if we're in icon mode - special handling
        if (session.mode === 'icon') {
            logWithContext('handleSticker', 'Processing sticker in Icon Format mode');
            await ctx.reply('Processing your sticker in Icon Format, please wait...');
            
            // Get file details
            const fileId = ctx.message.sticker.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            
            // Download and process directly
            const response = await axios({
                url: fileLink,
                responseType: 'arraybuffer'
            });
            
            const buffer = Buffer.from(response.data);
            
            // Force resize to 100x100 for icon mode
            const processedBuffer = await sharp(buffer)
                .resize(100, 100, {
                    fit: sharp.fit.cover,
                    withoutEnlargement: false  // Force resize regardless of original size
                })
                .webp({ lossless: true })
                .toBuffer();
                
            // Save and send
            const userId = ctx.from.id;
            const filename = generateUniqueFilename('icon', 'webp', userId);
            const filePath = getTempPath(filename);
            
            fs.writeFileSync(filePath, processedBuffer);
            
            await ctx.replyWithDocument({
                source: filePath,
                filename: filename
            });
            
            // Clean up
            safeDeleteFile(filePath, 'handleSticker');
            
            await ctx.reply('Sticker resized to Icon Format!', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                        [{ text: 'Convert More Images', callback_data: 'convert_more' }]
                    ]
                }
            });
            
            return;
        }
        
        // PRIORITY #4: Regular sticker processing for other modes
        logWithContext('handleSticker', 'Processing sticker in standard Sticker Format mode');
        const result = await processStickerMessage(ctx);

        if (result.success) {
            await ctx.replyWithDocument({ 
                source: result.filePath, 
                filename: result.filename 
            });

            // Cleanup temporary file
            safeDeleteFile(result.filePath, 'handleSticker');

            await ctx.reply('Sticker processed successfully! What would you like to do next?', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                        [{ text: 'Process Another Sticker', callback_data: 'convert_more' }]
                    ],
                },
            });
        } else {
            throw new Error(result.error || 'Sticker processing failed.');
        }
    } catch (err) {
        logWithContext('handleSticker', 'Error processing sticker', err);
        
        // Specific error message for unsupported formats
        if (err.message.includes('unsupported image format')) {
            await ctx.reply('This appears to be an unsupported sticker format. Only static stickers are supported.');
        } else {
            await ctx.reply(`An error occurred: ${err.message}`);
        }
    }
}

// Handle sticker pack creation/addition
async function handleStickerForPack(ctx) {
    const session = getSession(ctx.chat.id);
    
    try {
        await ctx.reply('Processing sticker for your pack...');
        
        let fileId, stickerType = 'static';
        
        // Extract file ID and determine type
        if (ctx.message.photo && ctx.message.photo.length > 0) {
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else if (ctx.message.document) {
            fileId = ctx.message.document.file_id;
            
            // Check document type
            const mimeType = ctx.message.document.mime_type || '';
            if (mimeType === 'application/x-tgsticker') {
                stickerType = 'animated';
            } else if (mimeType === 'video/webm') {
                stickerType = 'video';
            }
        } else if (ctx.message.sticker) {
            // Get sticker type
            const sticker = ctx.message.sticker;
            stickerType = sticker.is_animated ? 'animated' : (sticker.is_video ? 'video' : 'static');
            fileId = sticker.file_id;
        } else {
            await ctx.reply('Please send a valid image or sticker.');
            return;
        }
        
        try {
            let filePath;
            
            // Process according to sticker type
            if (stickerType === 'animated' || stickerType === 'video') {
                // Process animated/video sticker
                const result = await processAnimatedSticker(ctx, fileId);
                if (!result.success) {
                    throw new Error(result.error || `Failed to process ${stickerType} sticker`);
                }
                filePath = result.filePath;
                stickerType = result.type; // Use the more specific type from the processor
            } else {
                // Process static sticker
                filePath = await processImageToFile(ctx, fileId, { 
                    width: 512, 
                    height: 462, 
                    addBuffer: true,
                    forceResize: true
                });
            }
            
            // Check if we're creating a new pack or adding to existing
            if (session.packCreationStep === 'waiting_first_sticker') {
                // Create new pack with first sticker
                await createStickerSet(ctx, session.currentPackName, session.packTitle, filePath, '😊', stickerType);
                session.packCreationStep = 'adding_stickers';
                
                await ctx.reply(`Pack "${session.packTitle}" created with first sticker! Send more stickers to add to this pack.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'Done', callback_data: 'finish_adding'}],
                            [{text: 'View Pack', url: `https://t.me/addstickers/${session.currentPackName}`}]
                        ]
                    }
                });
            } else {
                // Add to existing pack
                await addStickerToSet(ctx, session.currentPackName, filePath, '😊', stickerType);
                
                await ctx.reply('Sticker added to pack! Send more stickers or press "Done" when finished.', {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'Done', callback_data: 'finish_adding'}],
                            [{text: 'View Pack', url: `https://t.me/addstickers/${session.currentPackName}`}]
                        ]
                    }
                });
            }
            
            // Clean up temp file
            safeDeleteFile(filePath, 'handleStickerForPack');
            
        } catch (err) {
            logWithContext('handleStickerForPack', 'Error processing sticker', err);
            
            // Check if it's an unsupported format error
            if (err.message.includes('unsupported image format')) {
                await ctx.reply('This appears to be an unsupported format. Please send a supported sticker or image.');
            } else if (err.message.includes('STICKER_TGS_INVALID')) {
                await ctx.reply('The animated sticker file is invalid. It must follow Telegram\'s TGS format guidelines.');
            } else if (err.message.includes('STICKER_VIDEO_INVALID')) {
                await ctx.reply('The video sticker file is invalid. It must be WebM with VP9 codec, max 3 seconds, max 30fps.');
            } else {
                await ctx.reply(`Error: ${err.message}`);
            }
        }
    } catch (err) {
        logWithContext('handleStickerForPack', 'Error handling sticker for pack', err);
        await ctx.reply(`Error: ${err.message}`);
    }
}

// Handle text messages for pack creation
async function handleText(ctx) {
    const session = getSession(ctx.chat.id);
    const message = ctx.message.text;
    
    // Handle pack naming step
    if (session.mode === 'packs' && session.packCreationStep === 'awaiting_name') {
        const packTitle = message.trim();
        if (packTitle.length < 3) {
            ctx.reply('Pack name is too short. Please use at least 3 characters.');
            return;
        }
        
        // Generate suitable name for Telegram API
        const packName = generateStickerSetName(ctx, packTitle);
        session.currentPackName = packName;
        session.packTitle = packTitle;
        
        // We can't create an empty pack - Telegram requires at least one sticker
        // So we'll just save the name and wait for the first sticker
        session.packCreationStep = 'waiting_first_sticker';
        
        ctx.reply(`Pack name "${packTitle}" is ready! Now send your first sticker or image to create the pack.`);
        return;
    }
    
    // Handle external pack addition
    if (session.mode === 'packs' && session.packCreationStep === 'awaiting_external_pack') {
        const input = message.trim();
        const packName = extractStickerSetName(input);
        
        if (!packName) {
            return ctx.reply('Invalid sticker pack format. Please send a link like https://t.me/addstickers/PackName or forward a sticker from the pack.');
        }
        
        try {
            // Add to user's collection
            await addExternalStickerPack(ctx, packName);
            
            // Check if user can edit this pack
            const canEdit = await canUserEditPack(ctx, packName);
            
            if (canEdit) {
                session.currentPackName = packName;
                session.packCreationStep = 'adding_stickers';
                
                return ctx.reply(`Pack "${packName}" added to your collection! You can add stickers to this pack.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'Add Stickers', callback_data: `select_pack:${packName}`}],
                            [{text: 'View Pack', url: `https://t.me/addstickers/${packName}`}],
                            [{text: 'Return to Pack Management', callback_data: 'select_packs'}]
                        ]
                    }
                });
            } else {
                session.packCreationStep = null;
                return ctx.reply(`Pack "${packName}" added to your collection for reference, but you don't have permission to edit it. Only packs created by you with this bot can be edited.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'View Pack', url: `https://t.me/addstickers/${packName}`}],
                            [{text: 'Return to Pack Management', callback_data: 'select_packs'}]
                        ]
                    }
                });
            }
        } catch (error) {
            session.packCreationStep = null;
            return ctx.reply(`Error: ${error.message}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{text: 'Try Again', callback_data: 'add_external_pack'}],
                        [{text: 'Return to Pack Management', callback_data: 'select_packs'}]
                    ]
                }
            });
        }
    }

    // Handle other text messages
    if (message.startsWith('/')) {
        // It's a command, let built-in handlers deal with it
        return;
    }
    
    ctx.reply('Please send an image or sticker to process. If you need to start over, use /start.');
}

export {
    handlePhotoDocument,
    handleSticker,
    handleStickerForPack,
    handleText
};