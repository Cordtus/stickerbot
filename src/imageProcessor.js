const axios = require('axios');
const sharp = require('sharp');

async function processImageMessage(ctx) {
    const fileId = ctx.message.photo.pop().file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
  
    try {
        // Download the image using axios
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
  
        // Process the buffer with sharp
        const processedBuffer = await sharp(buffer)
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
            .toBuffer();
        
        // Send processed image back to user
        ctx.replyWithPhoto({ source: processedBuffer });
    } catch (err) {
        console.error(err);
        ctx.reply('There was an error processing your image.');
    }
}

module.exports = processImageMessage;
