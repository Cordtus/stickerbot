// imageProcessor.js

import sharp from 'sharp';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { ensureTempDirectory, tempDir } from './fileHandler.js';

const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

// Validate file type and size using Telegram's file info API
async function validateImage(ctx, fileId) {
    try {
        const fileInfo = await ctx.telegram.getFile(fileId);
        console.log(`Validating file: fileId=${fileId}, size=${fileInfo.file_size}`);

        if (fileInfo.file_size > SIZE_LIMIT) {
            throw new Error(`File size exceeds the limit of ${SIZE_LIMIT / (1024 * 1024)} MB. Please compress the file and try again.`);
        }

        return fileInfo;
    } catch (err) {
        console.error(`File validation failed: ${err.message}`);
        throw err;
    }
}

// Validate image metadata after download
async function validateImageMetadata(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        console.log(`Metadata: ${JSON.stringify(metadata)}`);

        if (!metadata.width || !metadata.height) {
            throw new Error('Invalid image metadata: dimensions are missing. Ensure the file is a proper image.');
        }

        return metadata;
    } catch (err) {
        throw new Error(`Unsupported or invalid image format. Error: ${err.message}`);
    }
}

// Download file from Telegram
async function downloadFile(ctx, fileId) {
    const fileInfo = await validateImage(ctx, fileId);
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
}

// Process an individual image with dynamic options
async function processImage(ctx, fileId, options) {
    try {
        const buffer = await downloadFile(ctx, fileId);
        const metadata = await validateImageMetadata(buffer);
        console.log(`Processing image: ${fileId}, Dimensions: ${metadata.width}x${metadata.height}`);

        let sharpInstance = sharp(buffer);
        
        // Only resize if dimensions are specified
        if (options.width && options.height) {
            sharpInstance = sharpInstance.resize(options.width, options.height, {
                fit: sharp.fit.cover,
                withoutEnlargement: options.forceResize ?? false,
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

        return await sharpInstance.webp().toBuffer();
    } catch (err) {
        console.error(`Error processing image (${fileId}): ${err.message}`);
        throw new Error(`Image processing failed for file ID: ${fileId}. Error: ${err.message}`);
    }
}

// Process an image and save to a temporary file, returning the file path
async function processImageToFile(ctx, fileId, options) {
    try {
        const buffer = await processImage(ctx, fileId, options);
        ensureTempDirectory();
        
        const userId = ctx.from.id;
        const filename = `sticker-${userId}-${Date.now()}.webp`;
        const filePath = path.join(tempDir, filename);
        
        fs.writeFileSync(filePath, buffer);
        return filePath;
    } catch (err) {
        console.error(`Error processing image to file (${fileId}): ${err.message}`);
        throw err;
    }
}

// Process multiple images, handle compressed and uncompressed cases
async function processImages(ctx, images, options) {
    const userId = ctx.from.id;
    const processedFiles = [];
    const failedFiles = [];
    const skippedThumbnails = [];

    for (const image of images) {
        try {
            if (!image.fileId) {
                console.warn('Skipping invalid image with missing file_id.');
                failedFiles.push({ fileId: 'undefined', reason: 'Missing file_id' });
                continue;
            }

            const processedBuffer = await processImage(ctx, image.fileId, options);
            const filename = `converted-${userId}-${Date.now()}.webp`;
            await ctx.replyWithDocument({ source: processedBuffer, filename });
            processedFiles.push({ fileId: image.fileId, filename });
        } catch (err) {
            failedFiles.push({ fileId: image.fileId, reason: err.message });
            console.error(`Failed to process image (${image.fileId}): ${err.message}`);
        }
    }

    return {
        success: processedFiles,
        failures: failedFiles,
        skipped: skippedThumbnails,
    };
}

// Process an existing sticker (add transparent buffer)
async function processStickerMessage(ctx) {
    try {
        ensureTempDirectory();

        const { sticker } = ctx.message;
        if (!sticker || !sticker.file_id) {
            throw new Error('Sticker file ID is missing. Please resend the sticker.');
        }

        const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        const processedBuffer = await sharp(buffer)
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .extend({
                top: 0,
                bottom: 50,
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .toFormat('webp')
            .toBuffer();

        const userId = ctx.from.id;
        const filename = `sticker-${userId}-${Date.now()}.webp`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, processedBuffer);

        return { success: true, filePath, filename };
    } catch (err) {
        console.error(`Error processing sticker: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// Simple processing for WebP files with minimal changes
async function processWebpForSticker(ctx, fileId) {
    try {
        ensureTempDirectory();
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
            .toFormat('webp')
            .toBuffer();
            
        const userId = ctx.from.id;
        const filename = `sticker-${userId}-${Date.now()}.webp`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, processedBuffer);
        
        return { success: true, filePath, filename };
    } catch (err) {
        console.error(`Error processing WebP: ${err.message}`);
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