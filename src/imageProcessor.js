const axios = require('axios');
const sharp = require('sharp');

const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

async function processImageMessage(ctx) {
    // Check if the message contains a photo
    if (!ctx.message.photo) {
        ctx.reply('Please send a valid image file.');
        return;
    }

    // Get the file ID of the photo with the highest resolution
    const fileId = ctx.message.photo.pop().file_id;
    const fileInfo = await ctx.telegram.getFile(fileId);

    // Check if the file is an image and does not exceed the size limit
    if (!fileInfo.file_path || !fileInfo.mime_type.startsWith('image/')) {
        ctx.reply('Only image files are allowed.');
        return;
    } else if (fileInfo.file_size > SIZE_LIMIT) {
        ctx.reply('The file size exceeds the 50MB limit. Please send a smaller image.');
        return;
    }

    const fileLink = await ctx.telegram.getFileLink(fileId);

    try {
        // download image
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // get metadata to calculate resizing
        const metadata = await sharp(buffer).metadata();

        // calculate height plud  80px is <512px
        const maxHeight = 512 - 80; // max image height
        let newHeight = metadata.height;
        let newWidth = metadata.width;

        // if adding 80px exceeds 512, resize
        if (newHeight > maxHeight) {
            // calculate new dimensions, maintain aspect ratio
            const aspectRatio = metadata.width / metadata.height;
            newHeight = maxHeight;
            newWidth = Math.round(maxHeight * aspectRatio);
        }

        // process buffer
        sharp(buffer)
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
            .toBuffer()
            .then(processedBuffer => {
                // send processed image
                ctx.replyWithPhoto({ source: processedBuffer }).then(() => {
                    ctx.reply('If you want to format another image, please upload it.');
                });
            })
            .catch(err => {
                console.error(err);
                ctx.reply('There was an error processing your image.');
            });

    } catch (err) {
        console.error(err);
        ctx.reply('There was an error downloading your image.');
    }
}

module.exports = processImageMessage;
