import sharp from 'sharp';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { ensureTempDirectory, tempDir } from './fileHandling.js';

const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

// Process an individual image with dynamic options
async function processImage(ctx, fileId, options) {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    try {
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // Resize and optionally extend (add buffer)
        let sharpInstance = sharp(buffer).resize(options.width, options.height, {
            fit: sharp.fit.cover,
            withoutEnlargement: true
        });

        if (options.addBuffer) {
            sharpInstance = sharpInstance.extend({
                top: 0,
                bottom: 50,
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            });
        }

        return await sharpInstance.webp().toBuffer();
    } catch (err) {
        console.error('Error processing image:', err);
        ctx.reply('There was an error processing your image.');
        throw err;
    }
}

// Process multiple images with dynamic options
async function processImages(ctx, images, options) {
    for (const image of images) {
        try {
            const processedBuffer = await processImage(ctx, image.fileId, options);
            const timestamp = Date.now();
            const newFilename = `converted-${timestamp}.webp`;

            // Send the processed image to the user
            await ctx.replyWithDocument({ source: processedBuffer, filename: newFilename });
        } catch (err) {
            ctx.reply(`Failed to process one of the images: ${image.fileName || 'unknown file'}`);
        }
    }
}

// Handle existing sticker processing
async function processStickerMessage(ctx) {
    const { sticker, from } = ctx.message;
    const userId = from.id;
    const timestamp = Date.now();

    try {
        // Ensure the temp directory exists
        ensureTempDirectory();

        const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // Process the sticker with a transparent buffer
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

        // Save processed sticker
        const filename = `sticker-${userId}-${timestamp}.webp`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, processedBuffer);

        // Send the processed sticker to the user
        await ctx.replyWithDocument({ source: fs.createReadStream(filePath), filename });

        // Offer the user options to proceed
        await ctx.reply('Sticker processed successfully! What would you like to do next?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }],
                    [{ text: 'Convert More Stickers', callback_data: 'convert_more' }],
                ],
            },
        });

        // Clean up temporary file
        fs.unlinkSync(filePath);
    } catch (err) {
        console.error('Error processing sticker:', err);
        if (err.code !== 'ENOENT') {
            ctx.reply(`There was an error processing your sticker: ${err.message}`);
        }
    }
}

export { processImages, processStickerMessage };
