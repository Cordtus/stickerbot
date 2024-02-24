const axios = require('axios');
const sharp = require('sharp');

async function processImageMessage(ctx) {
    const fileId = ctx.message.photo.pop().file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    try {
        // Download the image using axios
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // Get metadata of the image to calculate the resizing dimensions
        const metadata = await sharp(buffer).metadata();

        // Calculate the height with the added space, ensuring it does not exceed 512 pixels
        const maxHeight = 512 - 80; // Max height for the image content itself
        let newHeight = metadata.height;
        let newWidth = metadata.width;

        // If adding 80 pixels exceeds the max height, resize accordingly
        if (newHeight > maxHeight) {
            // Calculate new dimensions while maintaining aspect ratio
            const aspectRatio = metadata.width / metadata.height;
            newHeight = maxHeight;
            newWidth = Math.round(maxHeight * aspectRatio);
        }

        // Process the buffer with sharp
        sharp(buffer)
            .resize(newWidth, newHeight, {
                fit: sharp.fit.inside,
                withoutEnlargement: true
            })
            .extend({
                top: 0,
                bottom: 80, // Add 80 pixels of transparent space at the bottom
                left: 0,
                right: 0,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer()
            .then(processedBuffer => {
                // Send processed image back to user
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
