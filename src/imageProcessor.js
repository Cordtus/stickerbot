const sharp = require('sharp');
const { Telegraf } = require('telegraf');

async function processImageMessage(ctx) {
    const fileId = ctx.message.photo.pop().file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    sharp(fileLink)
        .resize(512, 512, {
            fit: sharp.fit.inside,
            withoutEnlargement: true
        })
        .extend({
            top: 0,
            bottom: 80, // Adjust this dynamically based on image dimensions if necessary
            left: 0,
            right: 0,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .toBuffer()
        .then(buffer => {
            // Here you should handle the buffer (e.g., send it back to the user)
        })
        .catch(err => console.error(err));
}

module.exports = processImageMessage;
