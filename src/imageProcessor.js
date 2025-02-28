// imageProcessor.js

import sharp from 'sharp';
import axios from 'axios';
import { logWithContext } from './logger.js';
import { getTempPath, generateUniqueFilename } from './utils.js';
import { createTempFileFromBuffer, safeDeleteFile } from './fileHandler.js';

const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

/**
 * Validate file type and size using Telegram's file info API
 * @param {object} ctx - Telegram context
 * @param {string} fileId - File ID to validate
 * @returns {Promise<object>} File info
 */
async function validateImage(ctx, fileId) {
    try {
        const fileInfo = await ctx.telegram.getFile(fileId);
        logWithContext('imageProcessor', `Validating file: fileId=${fileId}, size=${fileInfo.file_size}`);

        if (fileInfo.file_size > SIZE_LIMIT) {
            throw new Error(`File size exceeds the limit of ${SIZE_LIMIT / (1024 * 1024)} MB. Please compress the file and try again.`);
        }

        return fileInfo;
    } catch (err) {
        logWithContext('imageProcessor', `File validation failed`, err);
        throw err;
    }
}

/**
 * Validate image metadata after download
 * @param {Buffer} buffer - Image buffer
 * @returns {Promise<object>} Image metadata
 */
async function validateImageMetadata(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        logWithContext('imageProcessor', `Image metadata: ${metadata.width}x${metadata.height}, format=${metadata.format}`);

        if (!metadata.width || !metadata.height) {
            throw new Error('Invalid image metadata: dimensions are missing. Ensure the file is a proper image.');
        }

        return metadata;
    } catch (err) {
        throw new Error(`Unsupported or invalid image format. Error: ${err.message}`);
    }
}

/**
 * Download file from Telegram
 * @param {object} ctx - Telegram context 
 * @param {string} fileId - File ID to download
 * @returns {Promise<Buffer>} File buffer
 */
async function downloadFile(ctx, fileId) {
    const fileInfo = await validateImage(ctx, fileId);
    const fileLink = await ctx.telegram.getFileLink(fileId);
    logWithContext('imageProcessor', `Downloading file from ${fileLink}`);
    
    const response = await axios({ 
        url: fileLink, 
        responseType: 'arraybuffer',
        timeout: 30000 // 30 second timeout
    });
    
    return Buffer.from(response.data);
}

/**
 * Process an individual image with dynamic options
 * @param {object} ctx - Telegram context
 * @param {string} fileId - File ID to process
 * @param {object} options - Processing options
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function processImage(ctx, fileId, options) {
    try {
        const buffer = await downloadFile(ctx, fileId);
        const metadata = await validateImageMetadata(buffer);
        logWithContext('imageProcessor', `Processing image: ${fileId}, Dimensions: ${metadata.width}x${metadata.height}`);

        let sharpInstance = sharp(buffer);
        
        // Always force resize in icon mode, regardless of file type
        if (options.width && options.height) {
            logWithContext('imageProcessor', `Resizing to ${options.width}x${options.height}, forceResize=${options.forceResize === true}`);
            sharpInstance = sharpInstance.resize({
                width: options.width,
                height: options.height,
                fit: sharp.fit.cover,
                withoutEnlargement: false  // Always resize even if smaller
            });
        }

        if (options.addBuffer) {
            sharpInstance = sharpInstance.extend({
                top: 0,
                bottom: 50,
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            });
        }

        // Ensure we always convert to webp with proper settings
        return await sharpInstance.webp({
            quality: 100,
            lossless: true
        }).toBuffer();
    } catch (err) {
        logWithContext('imageProcessor', `Error processing image (${fileId})`, err);
        throw new Error(`Image processing failed for file ID: ${fileId}. Error: ${err.message}`);
    }
}

/**
 * Process an image and save to a temporary file
 * @param {object} ctx - Telegram context
 * @param {string} fileId - File ID to process
 * @param {object} options - Processing options
 * @returns {Promise<string>} Path to processed file
 */
async function processImageToFile(ctx, fileId, options) {
    try {
        const buffer = await processImage(ctx, fileId, options);
        const userId = ctx.from.id;
        return createTempFileFromBuffer(buffer, userId, 'sticker', 'webp');
    } catch (err) {
        logWithContext('imageProcessor', `Error processing image to file (${fileId})`, err);
        throw err;
    }
}

/**
 * Process multiple images
 * @param {object} ctx - Telegram context
 * @param {Array} images - Array of image objects
 * @param {object} options - Processing options
 * @returns {Promise<object>} Processing results
 */
async function processImages(ctx, images, options) {
    const userId = ctx.from.id;
    const processedFiles = [];
    const failedFiles = [];
    const skippedThumbnails = [];

    for (const image of images) {
        try {
            if (!image.fileId) {
                logWithContext('imageProcessor', 'Skipping invalid image with missing file_id');
                failedFiles.push({ fileId: 'undefined', reason: 'Missing file_id' });
                continue;
            }

            const processedBuffer = await processImage(ctx, image.fileId, options);
            const filename = generateUniqueFilename('converted', 'webp', userId);
            await ctx.replyWithDocument({ source: processedBuffer, filename });
            processedFiles.push({ fileId: image.fileId, filename });
        } catch (err) {
            failedFiles.push({ fileId: image.fileId, reason: err.message });
            logWithContext('imageProcessor', `Failed to process image (${image.fileId})`, err);
        }
    }

    return {
        success: processedFiles,
        failures: failedFiles,
        skipped: skippedThumbnails,
    };
}

/**
 * Process an existing sticker
 * @param {object} ctx - Telegram context
 * @returns {Promise<object>} Processing result
 */
async function processStickerMessage(ctx) {
    try {
        const { sticker } = ctx.message;
        if (!sticker || !sticker.file_id) {
            throw new Error('Sticker file ID is missing. Please resend the sticker.');
        }

        const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        const processedBuffer = await sharp(buffer)
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .extend({
                top: 0,
                bottom: 50,
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp({ lossless: true })
            .toBuffer();

        const userId = ctx.from.id;
        const filename = generateUniqueFilename('sticker', 'webp', userId);
        const filePath = createTempFileFromBuffer(processedBuffer, userId, 'sticker', 'webp');

        return { success: true, filePath, filename };
    } catch (err) {
        logWithContext('imageProcessor', `Error processing sticker`, err);
        return { success: false, error: err.message };
    }
}

/**
 * Simple processing for WebP files with minimal changes
 * @param {object} ctx - Telegram context
 * @param {string} fileId - File ID to process 
 * @returns {Promise<object>} Processing result
 */
async function processWebpForSticker(ctx, fileId) {
    try {
        const buffer = await downloadFile(ctx, fileId);
        
        // Just add buffer to WebP file without resizing
        const processedBuffer = await sharp(buffer)
            .extend({
                top: 0,
                bottom: 50,
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp({ lossless: true })
            .toBuffer();
            
        const userId = ctx.from.id;
        const filename = generateUniqueFilename('sticker', 'webp', userId);
        const filePath = createTempFileFromBuffer(processedBuffer, userId, 'sticker', 'webp');
        
        return { success: true, filePath, filename };
    } catch (err) {
        logWithContext('imageProcessor', `Error processing WebP`, err);
        return { success: false, error: err.message };
    }
}

export { 
    processImage, 
    processImages, 
    processStickerMessage, 
    processImageToFile,
    processWebpForSticker,
    downloadFile 
};