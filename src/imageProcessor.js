const axios = require('axios');
const sharp = require('sharp');
const os = require('os');
const tempDir = os.tmpdir();
const fs = require('fs');
const path = require('path');

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
    const sticker = ctx.message.sticker;
    const fileId = sticker.file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
  
    // Correctly define the file extension for static and animated stickers
    const fileExt = sticker.is_animated ? 'tgs' : 'webp'; // Use 'webp' for static and 'tgs' for animated
    const filename = `sticker.${fileExt}`;
    const filePath = path.join(tempDir, filename);
  
    try {
      const response = await axios({ url: fileLink, responseType: 'stream' });
      const writer = fs.createWriteStream(filePath);

      response.data.pipe(writer);
  
      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          resolve({ filePath, filename }); // Resolve with both filePath and filename
        });
  
        writer.on('error', err => {
          console.error(err);
          ctx.reply('There was an error processing your sticker.');
          // Clean up any files that may have been partially written
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          reject(err); // Reject on error
        });
      });
    } catch (err) {
      console.error(err);
      ctx.reply('There was an error processing your sticker.');
      return null;
    }
}


  module.exports = { processImageContent, processStickerMessage };
