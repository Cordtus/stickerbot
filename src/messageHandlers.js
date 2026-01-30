// messageHandlers.js

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getSession, setProcessingState, checkCooldown, setCooldown } from './sessionManager.js';
import { 
    processImages, 
    processStickerMessage, 
    processImageToFile, 
    processWebpForSticker 
} from './imageProcessor.js';
import { 
    processVideo,
    isVideoFile,
    formatMetrics,
    VIDEO_CONSTRAINTS,
    BOT_LIMITS
} from './videoProcessor.js';
import { 
    addStickerToSet, 
    createStickerSet, 
    generateStickerSetName,
    addExternalPack,
    canUserEditPack,
    detectStickerType
} from './stickerManager.js';
import { extractStickerSetName } from './utils.js';
import { ensureTempDirectory, tempDir } from './fileHandler.js';
import { getSystemSpec } from './configurator.js';

// Enhanced logger that provides context
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

// Handle photos, documents, and videos
async function handlePhotoDocument(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handlePhotoDocument', `Started with mode=${session.mode}, step=${session.packCreationStep}`);

    // Require mode selection first
    if (!session.mode) {
        await ctx.reply('Please select a mode first using /start.');
        return;
    }
    
    // Handle pack mode workflow
    if (session.mode === 'packs') {
        // Handle different pack creation steps
        if (session.packCreationStep === 'waiting_title') {
            await ctx.reply('Please provide a title for your sticker pack first, then send your media.');
            return;
        }
        
        if (session.packCreationStep === 'awaiting_external_pack') {
            await ctx.reply('Please send a sticker from the pack you want to add, or send a pack link first.');
            return;
        }
        
        // Process media for pack if in correct steps
        if (session.packCreationStep === 'adding_stickers' || 
            session.packCreationStep === 'waiting_first_sticker') {
            logWithContext('handlePhotoDocument', `Redirecting to sticker pack handler - packName=${session.currentPackName}`);
            await handleMediaForPack(ctx);
            return;
        }
        
        // No specific step - offer pack creation options
        await ctx.reply('You\'re in sticker pack mode. Would you like to create a new pack or add to an existing one?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                    [{ text: 'Add to Existing Pack', callback_data: 'list_packs' }],
                    [{ text: 'Back to Main Menu', callback_data: 'start_over' }]
                ]
            }
        });
        return;
    }

    // Extract files to process
    let files = [];
    let isVideo = false;
    
    // Check for video files first
    if (ctx.message.document && isVideoFile(ctx.message.document.mime_type)) {
        const doc = ctx.message.document;
        files.push({ fileId: doc.file_id, fileName: doc.file_name, fileSize: doc.file_size, mimeType: doc.mime_type });
        isVideo = true;
        logWithContext('handlePhotoDocument', `Processing video document: ${doc.file_name} (${doc.mime_type})`);
    }
    // Handle video messages (MP4, etc.)
    else if (ctx.message.video) {
        const video = ctx.message.video;
        files.push({ fileId: video.file_id, fileSize: video.file_size, mimeType: 'video/mp4' });
        isVideo = true;
        logWithContext('handlePhotoDocument', `Processing video message: ${video.file_id}`);
    }
    // Handle animation/GIF
    else if (ctx.message.animation) {
        const animation = ctx.message.animation;
        files.push({ fileId: animation.file_id, fileName: animation.file_name, fileSize: animation.file_size, mimeType: animation.mime_type });
        isVideo = true;
        logWithContext('handlePhotoDocument', `Processing animation: ${animation.file_name} (${animation.mime_type})`);
    }
    // WebP in icon mode (images only)
    else if (ctx.message.document && 
        ctx.message.document.mime_type === 'image/webp' && 
        session.mode === 'icon') {
        
        await ctx.reply('Processing your WebP image, please wait...');
        
        try {
            // Get file details
            const fileId = ctx.message.document.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            
            // Download using fetch
            const response = await fetch(fileLink);
            const buffer = Buffer.from(await response.arrayBuffer());
            
            // Force resize to 100x100 for icon mode
            const processedBuffer = await sharp(buffer)
                .resize(100, 100, {
                    fit: sharp.fit.cover,
                    withoutEnlargement: false  // Force resize regardless of original size
                })
                .webp({ lossless: true })
                .toBuffer();
                
            // Save and send
            ensureTempDirectory();
            const userId = ctx.from.id;
            const filename = `icon-${userId}-${Date.now()}.webp`;
            const filePath = path.join(tempDir, filename);
            
            fs.writeFileSync(filePath, processedBuffer);
            
            await ctx.replyWithDocument({
                source: filePath,
                filename: filename
            });
            
            // Clean up
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
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
    // Standard image processing
    else if (ctx.message.photo && ctx.message.photo.length > 0) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        files.push({ fileId: photo.file_id, fileSize: photo.file_size });
        logWithContext('handlePhotoDocument', `Processing photo with fileId=${photo.file_id}`);
    } else if (ctx.message.document) {
        const doc = ctx.message.document;
        files.push({ fileId: doc.file_id, fileName: doc.file_name, fileSize: doc.file_size });
        logWithContext('handlePhotoDocument', `Processing document with fileId=${doc.file_id}, fileName=${doc.file_name}`);
    }

    if (files.length === 0) {
        await ctx.reply('No valid files were found in your message. Please send an image, GIF, or video.');
        return;
    }

    // Handle video processing
    if (isVideo) {
        await handleVideoProcessing(ctx, files[0], session.mode);
        return;
    }

    // Handle image processing (existing logic)
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

// Handle video processing
async function handleVideoProcessing(ctx, file, mode) {
    const session = getSession(ctx.chat.id);
    
    try {
        // Check if user is on cooldown
        const cooldownRemaining = checkCooldown(ctx.from.id, 'video');
        if (cooldownRemaining > 0) {
            await ctx.reply(`Please wait ${cooldownRemaining} seconds before processing another video.`);
            return;
        }
        
        // Check if user is already processing
        if (session.isProcessing) {
            await ctx.reply('You already have a video being processed. Please wait for it to complete.');
            return;
        }
        
        logWithContext('handleVideoProcessing', `Processing video in ${mode} mode: ${file.fileName || file.fileId}`);
        
        // Set processing state
        setProcessingState(ctx.chat.id, true);
        
        // Check file size limits
        const constraints = VIDEO_CONSTRAINTS[mode] || VIDEO_CONSTRAINTS.sticker;
        const maxUploadSize = BOT_LIMITS.maxFileSize;
        
        if (file.fileSize > maxUploadSize) {
            await ctx.reply(`File size (${Math.round(file.fileSize / 1024 / 1024)}MB) exceeds bot limit (${maxUploadSize / 1024 / 1024}MB). Please use a smaller file.`);
            setProcessingState(ctx.chat.id, false);
            return;
        }
        
        // use cached system specs
        const spec = await getSystemSpec();
        const optimizedFor = spec ? spec.summary.optimizedFor : 'CPU';
        
        // Show processing indicator
        const processingMessage = await ctx.reply(
            `Processing your video...\n` +
            `Mode: ${mode === 'icon' ? 'Icon (100x100)' : 'Sticker (512x512)'}\n` +
            `Progress: 0%`
        );

        let lastProgress = 0;
        let lastUpdateTime = 0;

        // Progress callback - throttle updates to avoid rate limiting
        const onProgress = async (percent) => {
            const now = Date.now();
            // Only update if progress changed significantly and at least 1.5s since last update
            if (percent > lastProgress + 5 && now - lastUpdateTime > 1500) {
                lastProgress = percent;
                lastUpdateTime = now;
                try {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        processingMessage.message_id,
                        undefined,
                        `Processing your video...\n` +
                        `Mode: ${mode === 'icon' ? 'Icon (100x100)' : 'Sticker (512x512)'}\n` +
                        `Progress: ${percent}%`
                    );
                } catch (err) {
                    // Ignore edit errors (rate limit or message too old)
                }
            }
        };

        // Process the video with progress callback
        const result = await processVideo(ctx, file.fileId, mode, onProgress);

        // Clear processing state
        setProcessingState(ctx.chat.id, false);
        
        // Delete processing message
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
        } catch (err) {
            // Ignore delete msg errors
        }
        
        // validate result
        if (!result || !result.success) {
            throw new Error('Video processing failed');
        }
        
        // Send processed video
        const filename = `${mode === 'icon' ? 'icon' : 'sticker'}-${Date.now()}.webm`;
        
        await ctx.replyWithDocument({
            source: result.filePath,
            filename: filename
        });
        
        // Format and send completion message
        if (result.metadata) {
            const metrics = formatMetrics(result.metadata);
            const metricsText = 
                `Processing Complete!\n\n` +
                `Original: ${metrics.original.size} • ${metrics.original.duration} • ${metrics.original.resolution}\n` +
                `Final: ${metrics.final.size} • ${metrics.final.duration} • ${metrics.final.resolution}\n` +
                `Processing: ${metrics.processing.time} on ${metrics.processing.hardware}\n\n` +
                `Optimized for Telegram ${mode === 'icon' ? 'emojis' : 'stickers'}!`;
            
            await ctx.reply(metricsText);
        }
        
        // Clean up
        if (result.cleanup && typeof result.cleanup === 'function') {
            result.cleanup();
        } else if (result.filePath && fs.existsSync(result.filePath)) {
            fs.unlinkSync(result.filePath);
        }
        
        // Set cooldown (60 seconds)
        setCooldown(ctx.from.id, 'video', 60);
        
        // Show next steps
        await ctx.reply('What would you like to do next?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                    [{ text: 'Convert More Media', callback_data: 'convert_more' }]
                ]
            }
        });
        
    } catch (err) {
        // Clear processing state and indicators
        setProcessingState(ctx.chat.id, false);
        logWithContext('handleVideoProcessing', 'Error processing video', err);
        
        let errorMessage = `Video processing failed: ${err.message}`;
        
        // Add helpful tips for common errors
        if (err.message.includes('duration')) {
            errorMessage += `\n\nTip: Videos must be ${BOT_LIMITS.maxDuration} seconds or shorter.`;
        } else if (err.message.includes('size')) {
            errorMessage += '\n\nTip: Try using a shorter or lower quality video.';
        } else if (err.message.includes('format')) {
            errorMessage += '\n\nTip: Supported formats: MP4, GIF, WebM, MOV, AVI.';
        }
        
        await ctx.reply(errorMessage, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                    [{ text: 'Try Another File', callback_data: 'convert_more' }]
                ]
            }
        });
    }
}

// Handle stickers
async function handleSticker(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleSticker', `Started with mode=${session.mode}, step=${session.packCreationStep}`);

    // Check if this is an animated sticker
    if (ctx.message.sticker.is_animated) {
        await ctx.reply('Animated stickers (.tgs files) are not supported for processing. Please send a static sticker or image/video instead.');
        return;
    }

    // Check if this is a video sticker
    if (ctx.message.sticker.is_video) {
        await ctx.reply('Video stickers (.webm files) cannot be reprocessed. Please send a regular video file or image instead.');
        return;
    }

    // Check if we're in sticker pack creation or editing mode
    if (session.mode === 'packs' && 
        (session.packCreationStep === 'adding_stickers' || 
         session.packCreationStep === 'waiting_first_sticker')) {
        logWithContext('handleSticker', `Handling sticker for pack creation/editing - packName=${session.currentPackName}`);
        await handleMediaForPack(ctx);
        return;
    }

    // Handle forwarded sticker for external pack addition
    if (session.mode === 'packs' && session.packCreationStep === 'awaiting_external_pack') {
        try {
            // Extract pack info from sticker
            if (!ctx.message.sticker.set_name) {
                return ctx.reply('This sticker doesn\'t belong to a pack. Please forward a sticker from a pack or send a pack link.');
            }
            
            const packName = ctx.message.sticker.set_name;
            logWithContext('handleSticker', `Processing external pack: ${packName}`);
            
            // Add to user's collection
            await addExternalPack(ctx, packName);
            
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
    
    try {
        // Check if we're in icon mode - special handling
        if (session.mode === 'icon') {
            logWithContext('handleSticker', 'Processing sticker in Icon Format mode');
            await ctx.reply('Processing your sticker in Icon Format, please wait...');
            
            // Get file details
            const fileId = ctx.message.sticker.file_id;
            const fileLink = await ctx.telegram.getFileLink(fileId);
            
            // Download using fetch
            const response = await fetch(fileLink);
            const buffer = Buffer.from(await response.arrayBuffer());
            
            // Force resize to 100x100 for icon mode
            const processedBuffer = await sharp(buffer)
                .resize(100, 100, {
                    fit: sharp.fit.cover,
                    withoutEnlargement: false  // Force resize regardless of original size
                })
                .webp({ lossless: true })
                .toBuffer();
                
            // Save and send
            ensureTempDirectory();
            const userId = ctx.from.id;
            const filename = `icon-${userId}-${Date.now()}.webp`;
            const filePath = path.join(tempDir, filename);
            
            fs.writeFileSync(filePath, processedBuffer);
            
            await ctx.replyWithDocument({
                source: filePath,
                filename: filename
            });
            
            // Clean up
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
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
        
        // Regular sticker processing for other modes
        logWithContext('handleSticker', 'Processing sticker in standard Sticker Format mode');
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
        logWithContext('handleSticker', 'Error processing sticker', err);
        
        // Specific error message for unsupported formats
        if (err.message.includes('unsupported image format')) {
            await ctx.reply('This appears to be an unsupported sticker format. Only static stickers are supported.');
        } else {
            await ctx.reply(`An error occurred: ${err.message}`);
        }
    }
}

// Handle media (images/videos) for sticker pack creation/addition
async function handleMediaForPack(ctx) {
    const session = getSession(ctx.chat.id);
    
    try {
        let fileId;
        let isVideo = false;
        
        // Determine file type and ID
        if (ctx.message.photo && ctx.message.photo.length > 0) {
            fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        } else if (ctx.message.document) {
            fileId = ctx.message.document.file_id;
            isVideo = isVideoFile(ctx.message.document.mime_type);
        } else if (ctx.message.video) {
            fileId = ctx.message.video.file_id;
            isVideo = true;
        } else if (ctx.message.animation) {
            fileId = ctx.message.animation.file_id;
            isVideo = true;
        } else if (ctx.message.sticker) {
            // Check if this is an animated or video sticker
            if (ctx.message.sticker.is_animated) {
                await ctx.reply('Animated stickers (.tgs files) are not supported. Please send a static sticker, image, or video instead.');
                return;
            }
            if (ctx.message.sticker.is_video) {
                await ctx.reply('Video stickers (.webm files) cannot be reprocessed. Please send a regular video file or image instead.');
                return;
            }
            
            fileId = ctx.message.sticker.file_id;
        } else {
            await ctx.reply('Please send a valid image, video, GIF, or sticker.');
            return;
        }
        
        // Check cooldown for video processing
        if (isVideo) {
            const cooldownRemaining = checkCooldown(ctx.from.id, 'video');
            if (cooldownRemaining > 0) {
                await ctx.reply(`Please wait ${cooldownRemaining} seconds before processing another video.`);
                return;
            }
            
            // Check if user is already processing
            if (session.isProcessing) {
                await ctx.reply('You already have a video being processed. Please wait for it to complete.');
                return;
            }
        }
        
        let filePath;
        let processingMessage;
        
        try {
            if (isVideo) {
                // Set processing state for video
                setProcessingState(ctx.chat.id, true);

                // Show processing indicator for video
                processingMessage = await ctx.reply(
                    `Processing video for sticker pack...\n` +
                    `Progress: 0%`
                );

                let lastProgress = 0;
                let lastUpdateTime = 0;

                // Progress callback
                const onProgress = async (percent) => {
                    const now = Date.now();
                    if (percent > lastProgress + 5 && now - lastUpdateTime > 1500) {
                        lastProgress = percent;
                        lastUpdateTime = now;
                        try {
                            await ctx.telegram.editMessageText(
                                ctx.chat.id,
                                processingMessage.message_id,
                                undefined,
                                `Processing video for sticker pack...\n` +
                                `Progress: ${percent}%`
                            );
                        } catch (err) {
                            // Ignore edit errors
                        }
                    }
                };

                // Process video/GIF for sticker pack
                const result = await processVideo(ctx, fileId, 'sticker', onProgress);
                filePath = result.filePath;
                
                // Clear processing state
                setProcessingState(ctx.chat.id, false);
                
                // Delete processing message
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
                } catch (err) {
                    // Ignore delete errors
                }
                
                // Set cooldown for video processing
                setCooldown(ctx.from.id, 'video', 60);
            } else {
                await ctx.reply('Processing media for your pack...');
                
                // Process image/sticker to standard sticker format
                // forceResize: false preserves aspect ratio (fit.inside)
                filePath = await processImageToFile(ctx, fileId, {
                    width: 512,
                    height: 462,
                    addBuffer: true
                });
            }
            
            // Detect sticker type from processed file
            const stickerType = detectStickerType(filePath);
            
            // Check if we're creating a new pack or adding to existing
            if (session.packCreationStep === 'waiting_first_sticker') {
                // Create new pack with first sticker
                await createStickerSet(ctx, session.currentPackName, session.packTitle, filePath, '😊', stickerType.isVideo);
                session.packCreationStep = 'adding_stickers';
                
                const packType = stickerType.isVideo ? 'video sticker' : (stickerType.isAnimated ? 'animated sticker' : 'sticker');
                await ctx.reply(`Pack "${session.packTitle}" created with first ${packType}! Send more media to add to this pack.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'Done', callback_data: 'finish_adding'}],
                            [{text: 'View Pack', url: `https://t.me/addstickers/${session.currentPackName}`}]
                        ]
                    }
                });
            } else {
                // Add to existing pack
                await addStickerToSet(ctx, session.currentPackName, filePath, '😊', stickerType.isVideo);
                
                const packType = stickerType.isVideo ? 'Video sticker' : (stickerType.isAnimated ? 'Animated sticker' : 'Sticker');
                await ctx.reply(`${packType} added to pack! Send more media or press "Done" when finished.`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: 'Done', callback_data: 'finish_adding'}],
                            [{text: 'View Pack', url: `https://t.me/addstickers/${session.currentPackName}`}]
                        ]
                    }
                });
            }
            
            // Clean up temp file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            // Clear processing state on error
            if (isVideo) {
                setProcessingState(ctx.chat.id, false);
                
                // Delete processing message
                if (processingMessage) {
                    try {
                        await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
                    } catch (deleteErr) {
                        // Ignore delete errors
                    }
                }
            }
            
            console.error(`Error processing media: ${err.message}`);
            
            // Check if it's an unsupported format error
            if (err.message.includes('unsupported image format') || err.message.includes('Video processing failed')) {
                await ctx.reply(`This format is not supported. Please send a static image, GIF, or video under ${BOT_LIMITS.maxDuration} seconds.`);
            } else {
                await ctx.reply(`Error: ${err.message}`);
            }
        }
    } catch (err) {
        console.error('Error handling media for pack:', err.message);
        await ctx.reply(`Error: ${err.message}`);
    }
}

// Handle text messages for pack creation
async function handleText(ctx) {
    const session = getSession(ctx.chat.id);
    const message = ctx.message.text;
    
    // Handle pack naming step
    if (session.mode === 'packs' && session.packCreationStep === 'waiting_title') {
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
        
        ctx.reply(`Pack name "${packTitle}" is ready! Now send your first sticker, image, GIF, or video to create the pack.`);
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
            await addExternalPack(ctx, packName);
            
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
    
    ctx.reply('Please send an image, GIF, video, or sticker to process.');
}

export {
    handlePhotoDocument,
    handleSticker,
    handleMediaForPack,
    handleText
};