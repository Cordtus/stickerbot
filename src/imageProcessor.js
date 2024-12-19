// imageProcessor.js

import sharp from 'sharp';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { ensureTempDirectory, tempDir } from './fileHandler.js';

const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

// Validate image metadata
async function validateImage(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height) {
            throw new Error('Invalid image metadata: missing dimensions.');
        }
        return metadata;
    } catch (err) {
        throw new Error('Unsupported or invalid image format.');
    }
}

// Process an individual image with dynamic options
async function processImage(ctx, fileId, options) {
    try {
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });

        // Check file size before processing
        const contentLength = parseInt(response.headers['content-length'], 10);
        if (contentLength > SIZE_LIMIT) {
            throw new Error(`File size exceeds the limit of ${SIZE_LIMIT / (1024 * 1024)} MB.`);
        }

        const buffer = Buffer.from(response.data, 'binary');

        // Validate image metadata
        await validateImage(buffer);

        // Resize and optionally extend (add buffer)
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
        console.error(`Error processing image: ${err.message}`);
        throw err;
    }
}

// Process multiple images by calling processImage repeatedly
async function processImages(ctx, images, options) {
    const userId = ctx.from.id;
    const processedFiles = [];
    let failedCount = 0;

    for (const image of images) {
        try {
            const processedBuffer = await processImage(ctx, image.fileId, options);

            const filename = `converted-${userId}-${Date.now()}.webp`;
            await ctx.replyWithDocument({ source: processedBuffer, filename });
            processedFiles.push(filename);
        } catch (err) {
            failedCount++;
            console.error(`Failed to process image (${image.fileId}): ${err.message}`);
        }
    }

    // User feedback after processing
    if (processedFiles.length > 0) {
        await ctx.reply('Conversion completed! What would you like to do next?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Convert More Images', callback_data: 'convert_more' }],
                    [{ text: 'Start Over', callback_data: 'start_over' }],
                ],
            },
        });
    }

    if (failedCount > 0) {
        await ctx.reply(`Failed to process ${failedCount} image(s).`);
    }

    if (processedFiles.length === 0) {
        await ctx.reply('All images failed to process. Please try again.');
    }
}

// Process an existing sticker (add transparent buffer)
async function processStickerMessage(ctx) {
    const { sticker, from } = ctx.message;
    const userId = from.id;
    const timestamp = Date.now();

    try {
        ensureTempDirectory();

        const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // Validate image metadata
        await validateImage(buffer);

        const processedBuffer = await sharp(buffer)
            .resize({
                width: 512,
                height: 512,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .extend({
                top: 0,
                bottom: 50,
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .toFormat('webp')
            .toBuffer();

        const filename = `sticker-${userId}-${timestamp}.webp`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, processedBuffer);

        await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename });

        await ctx.reply('Sticker processed successfully! What would you like to do next?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                ],
            },
        });

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (err) {
        console.error('Error processing sticker:', err.message);
        await ctx.reply('An error occurred while processing your sticker. Please try again.');
    }
}

export { processImage, processImages, processStickerMessage };
