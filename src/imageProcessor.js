const axios = require('axios');
const sharp = require('sharp');

const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

// This function processes both photos and uncompressed images sent as documents.
async function processImage(ctx, fileId) {
    const fileLink = await ctx.telegram.getFileLink(fileId);

    try {
        // Download image
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // Get metadata to calculate resizing
        const metadata = await sharp(buffer).metadata();

        // Calculate height plus 80px is <512px
        const maxHeight = 512 - 80; // Max image height
        let newHeight = metadata.height;
        let newWidth = metadata.width;

        // If adding 80px exceeds 512, resize
        if (newHeight > maxHeight) {
            // Calculate new dimensions, maintain aspect ratio
            const aspectRatio = metadata.width / metadata.height;
            newHeight = maxHeight;
            newWidth = Math.round(maxHeight * aspectRatio);
        }

        // Process buffer
        return sharp(buffer)
            .resize(newWidth, newHeight, {
                fit: sharp.fit.inside,
                withoutEnlargement: true
            })
            .extend({
                top: 0,
                bottom: 80, // Add 80 px transparent space to bottom
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

// Handler for images sent as 'photo'
async function processImageMessage(ctx) {
    if (!ctx.message.photo) {
        ctx.reply('Please send a valid image file.');
        return;
    }

    const fileId = ctx.message.photo.pop().file_id;
    const fileInfo = await ctx.telegram.getFile(fileId);

    if (!fileInfo || !fileInfo.file_path) {
        ctx.reply('There was an issue with the file you sent. Please try again.');
        return;
    }

    if (fileInfo.file_size > SIZE_LIMIT) {
        ctx.reply('The file size exceeds the 50MB limit. Please send a smaller image.');
        return;
    }

    const processedBuffer = await processImage(ctx, fileId);
    if (processedBuffer) {
        ctx.replyWithPhoto({ source: processedBuffer }).then(() => {
            ctx.reply('If you want to format another image, please upload it.');
        });
    }
}

// Handler for images sent as 'document'
async function processImageFileMessage(ctx) {
    if (!ctx.message.document) {
        ctx.reply('Please send a valid image file.');
        return;
    }

    const document = ctx.message.document;
    if (document.mime_type && !document.mime_type.startsWith('image/')) {
        ctx.reply('Only image files are allowed.');
        return;
    }

    if (document.file_size > SIZE_LIMIT) {
        ctx.reply('The file size exceeds the 50MB limit. Please send a smaller image.');
        return;
    }

    const processedBuffer = await processImage(ctx, document.file_id);
    if (processedBuffer) {
        ctx.replyWithPhoto({ source: processedBuffer }).then(() => {
            ctx.reply('If you want to format another image, please upload it.');
        });
    }
}

module.exports = { processImageMessage, processImageFileMessage };
