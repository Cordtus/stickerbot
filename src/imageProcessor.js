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
        console.log(`Validating file: mimeType=${fileInfo.mime_type}, size=${fileInfo.file_size}`);

        if (!fileInfo.mime_type || !fileInfo.mime_type.startsWith('image/')) {
            throw new Error(`Unsupported file type (${fileInfo.mime_type || 'unknown'}). Please send a valid image file.`);
        }

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

// Process an individual image with dynamic options
async function processImage(ctx, fileId, options) {
    try {
        const fileInfo = await validateImage(ctx, fileId);
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        const metadata = await validateImageMetadata(buffer);
        console.log(`Processing image: ${fileInfo.file_id}, Dimensions: ${metadata.width}x${metadata.height}`);

        let sharpInstance = sharp(buffer).resize(options.width, options.height, {
            fit: sharp.fit.cover,
            withoutEnlargement: true,
        });

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

            // Skip thumbnails (e.g., very small images)
            if (image.fileSize && image.fileSize < SIZE_LIMIT / 10) {
                console.log(`Skipping thumbnail: ${image.fileId} (size: ${image.fileSize} bytes)`);
                skippedThumbnails.push(image.fileId);
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

    const successCount = processedFiles.length;
    const failCount = failedFiles.length;
    const skipCount = skippedThumbnails.length;

    // Provide user feedback
    if (successCount > 0) {
        await ctx.reply(`Successfully processed ${successCount} image(s).`);
    }

    if (failCount > 0) {
        await ctx.reply(`Failed to process ${failCount} image(s). Errors occurred during processing.`);
    }

    if (skipCount > 0) {
        await ctx.reply(`Skipped ${skipCount} thumbnail(s) because they were too small.`);
    }

    if (successCount === 0 && failCount === 0 && skipCount > 0) {
        await ctx.reply('No images were processed. All were skipped as thumbnails. Please send larger images.');
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

export { processImage, processImages, processStickerMessage };
