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

async function processImageContent(ctx) {
    let fileId;
    let fileSize;
    let mimeType;

    // Determine if the message contains a photo or a document
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

    // Fetch file info from Telegram
    const fileInfo = await ctx.telegram.getFile(fileId);

    // Check if the file size exceeds the limit or if the mime type is not an image
    if (fileSize && fileSize > SIZE_LIMIT) {
        ctx.reply('The file size exceeds the 50MB limit. Please send a smaller image.');
        return;
    }
    if (mimeType && !mimeType.startsWith('image/')) {
        ctx.reply('Only image files are allowed.');
        return;
    }

    // Process the image
    const processedBuffer = await processImage(ctx, fileId);
    if (processedBuffer) {
        // Send the processed image as a document
        ctx.replyWithDocument({ source: processedBuffer, filename: 'sticker.png' })
        .catch(err => {
            console.error(err);
            ctx.reply('There was an error sending your image.');
        });
    }
}

module.exports = { processImageContent };
