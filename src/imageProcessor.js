const sharp = require('sharp');
const axios = require('axios'); // Ensure axios is required
const path = require('path'); // Ensure path is required
const fs = require('fs');
const { ensureTempDirectory, downloadAndSaveFile, tempDir } = require('./fileHandling');
const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB


// processes both photos and uncompressed images sent as document
async function processImage(ctx, fileId) {
    const fileLink = await ctx.telegram.getFileLink(fileId);

    try {
        // Download image
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // Get metadata to calculate resizing
        const metadata = await sharp(buffer).metadata();

        // Calculate height plus 80px is <512px
        const maxHeight = 512 - 80; // max height
        let newHeight = metadata.height;
        let newWidth = metadata.width;

        // If adding 80px exceeds 512, resize
        if (newHeight > maxHeight) {
            // calculate dimensions, maintain aspect ratio
            const aspectRatio = metadata.width / metadata.height;
            newHeight = maxHeight;
            newWidth = Math.round(maxHeight * aspectRatio);
        }

        // process buffer
        return sharp(buffer)
            .resize(newWidth, newHeight, {
                fit: sharp.fit.inside,
                withoutEnlargement: true
            })
            .extend({
                top: 0,
                bottom: 80, // add 80 px transparent space to bottom
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer();
    } catch (err) {
        console.error(err);
        ctx.reply('There was an error processing your image.');
        return null;
    }
}

async function processImageContent(ctx) {
    const userId = ctx.from.id;
    let fileId;
    let fileSize;
    let mimeType;

    // determine if message is photo or doc
    if (ctx.message.photo) {
        fileId = ctx.message.photo.pop().file_id;
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        mimeType = ctx.message.document.mime_type;
        fileSize = ctx.message.document.file_size;
    } else {
        ctx.reply('Please send a valid image file.');
        return;
    }

    // fetch file info from tg
    const fileInfo = await ctx.telegram.getFile(fileId);

    // check if file size exceeds limit or mime type is not image
    if (fileSize && fileSize > SIZE_LIMIT) {
        ctx.reply('The file size exceeds the 50MB limit. Please send a smaller image.');
        return;
    }
    if (mimeType && !mimeType.startsWith('image/')) {
        ctx.reply('Only image files are allowed.');
        return;
    }

    // process image
    const processedBuffer = await processImage(ctx, fileId);
    if (processedBuffer) {
        // send processed image as document
        ctx.replyWithDocument({ source: processedBuffer, filename: 'sticker.png' })
        .catch(err => {
            console.error(err);
            ctx.reply('There was an error sending your image.');
        });
    }
}

async function processStickerMessage(ctx) {
    const { sticker, from } = ctx.message;
    const userId = from.id;
    const timestamp = Date.now();

    try {
        const fileInfo = await ctx.telegram.getFile(sticker.file_id);
        const fileExtension = fileInfo.file_path.split('.').pop();

        // Skip processing for animated stickers (which are typically .tgs files)
        if (fileExtension !== 'tgs') {
            const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
            const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');
            
            // Process image: resize and add 80px space
            const processedBuffer = await sharp(buffer)
                .metadata()
                .then(metadata => {
                    const maxHeight = 512 - 80; // max height
                    let newHeight = metadata.height;
                    let newWidth = metadata.width;

                    // If adding 80px exceeds 512, resize
                    if (newHeight > maxHeight) {
                        const aspectRatio = metadata.width / metadata.height;
                        newHeight = maxHeight;
                        newWidth = Math.round(maxHeight * aspectRatio);
                    }

                    return sharp(buffer)
                        .resize(newWidth, newHeight, {
                            fit: sharp.fit.inside,
                            withoutEnlargement: true
                        })
                        .extend({
                            top: 0,
                            bottom: 80, // add 80 px transparent space to bottom
                            left: 0,
                            right: 0,
                            background: { r: 0, g: 0, b: 0, alpha: 0 }
                        })
                        .toBuffer();
                });

            // Generate filename and save the processed sticker
            const originalFilename = `${timestamp}-${userId}-sticker.${fileExtension}`; // Prepend with timestamp and userId
            const savedFilePath = path.join(tempDir, originalFilename);
            fs.writeFileSync(savedFilePath, processedBuffer);

            // Send the processed file as a document
            await ctx.replyWithDocument({ source: fs.createReadStream(savedFilePath), filename: originalFilename });
        } else {
            // For animated stickers, you might want to handle them differently or skip processing
            ctx.reply('Animated stickers are not supported for custom processing.');
        }
    } catch (err) {
        console.error(err);
        ctx.reply('There was an error processing your sticker.');
    }
}

module.exports = { processImageContent, processStickerMessage };