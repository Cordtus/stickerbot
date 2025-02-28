// messageHandlers.js

import fs from 'fs';
import { getSession } from './sessionManager.js';
import { 
    processImages, 
    processStickerMessage, 
    processImageToFile, 
    processWebpForSticker 
} from './imageProcessor.js';
import { addStickerToSet, createStickerSet, generateStickerSetName } from './stickerManager.js';

// Handle photos and documents
async function handlePhotoDocument(ctx) {
    const session = getSession(ctx.chat.id);

    // Require mode selection first
    if (!session.mode) {
        await ctx.reply('Please select a mode first using /start.');
        return;
    }
    
    // Special handling for sticker pack mode
    if (session.mode === 'packs' && session.packCreationStep === 'adding_stickers') {
        await handleStickerForPack(ctx);
        return;
    }

    // Extract files to process
    let files = [];
    if (ctx.message.photo && ctx.message.photo.length > 0) {
        // Get the highest resolution photo
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        files.push({ fileId: photo.file_id, fileSize: photo.file_size });
    } else if (ctx.message.document) {
        // Accept all documents and let processor handle them
        const doc = ctx.message.document;
        files.push({ fileId: doc.file_id, fileName: doc.file_name, fileSize: doc.file_size });
    }

    if (files.length === 0) {
        await ctx.reply('No valid files were found in your message. Please send an image.');
        return;
    }

    // Indicate processing has started
    await ctx.reply('Processing your image(s), please wait...');
    session.images = files;

    try {
        // Special handling for WebP in document format
        if (ctx.message.document && 
            ctx.message.document.mime_type === 'image/webp' && 
            !session.mode) {
            
            // Process WebP with minimal changes
            const result = await processWebpForSticker(ctx, files[0].fileId);
            
            if (result.success) {
                await ctx.replyWithDocument({ 
                    source: result.filePath, 
                    filename: result.filename 
                });
                
                // Cleanup temp file
                if (fs.existsSync(result.filePath)) {
                    fs.unlinkSync(result.filePath);
                }
                
                await ctx.reply('Processing complete!', {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                        ]
                    }
                });
            } else {
                throw new Error(result.error || 'Failed to process WebP file');
            }
            
            return;
        }
        
        // Standard processing for selected modes
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
        console.error('Error during image processing:', err.message);
        await ctx.reply(`An error occurred: ${err.message}`);
    }
}

// Handle stickers
async function handleSticker(ctx) {
    const session = getSession(ctx.chat.id);
    
    // Special handling for sticker pack mode
    if (session.mode === 'packs' && session.packCreationStep === 'adding_stickers') {
        await handleStickerForPack(ctx);
        return;
    }
    
    try {
        const result = await processStickerMessage(ctx);

        if (result.success) {
            await ctx.replyWithDocument({ 
                source: result.filePath, 
                filename: result.filename 
            });

            // Cleanup temporary file
            if (fs.existsSync(result.filePath)) {
                fs.unlinkSync(result.filePath);
            }

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
        console.error('Error processing sticker:', err.message);
        await ctx.reply(`An error occurred: ${err.message}`);
    }
}

// Handle sticker pack creation/addition
async function handleStickerForPack(ctx) {
    const session = getSession(ctx.chat.id);
    
    try {
        await ctx.reply('Processing sticker for your pack...');
        
        let fileId;
        if (ctx.message.photo && ctx.message.photo.length > 0) {
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else if (ctx.message.document) {
            fileId = ctx.message.document.file_id;
        } else if (ctx.message.sticker) {
            fileId = ctx.message.sticker.file_id;
        } else {
            await ctx.reply('Please send a valid image or sticker.');
            return;
        }
        
        // Process the image/sticker to standard sticker format
        const filePath = await processImageToFile(ctx, fileId, { 
            width: 512, 
            height: 462, 
            addBuffer: true,
            forceResize: true
        });
        
        // Add to the pack with default emoji
        await addStickerToSet(ctx, session.currentPackName, filePath);
        
        // Clean up temp file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        await ctx.reply('Sticker added to pack! Send more stickers or press "Done" when finished.', {
            reply_markup: {
                inline_keyboard: [[{text: 'Done', callback_data: 'finish_adding'}]]
            }
        });
    } catch (err) {
        console.error('Error adding sticker to pack:', err.message);
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
        
        // Create the pack
        try {
            await createStickerSet(ctx, packName, packTitle);
            session.packCreationStep = 'adding_stickers';
            ctx.reply(`Pack "${packTitle}" created! Now send stickers or images to add to this pack.`, {
                reply_markup: {
                    inline_keyboard: [[{text: 'Done', callback_data: 'finish_adding'}]]
                }
            });
        } catch (err) {
            console.error('Error creating sticker set:', err.message);
            session.packCreationStep = null;
            ctx.reply(`Error creating pack: ${err.message}. Please try again.`, {
                reply_markup: {
                    inline_keyboard: [[{text: 'Try Again', callback_data: 'create_pack'}]]
                }
            });
        }
        return;
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