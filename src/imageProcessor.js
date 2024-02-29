const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { ensureTempDirectory, downloadAndSaveFile, tempDir } = require('./fileHandling');
const SIZE_LIMIT = 50 * 1024 * 1024; // 50 MB

// Processes both photos and uncompressed images sent as a document
async function processImage(ctx, fileId, userId) {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    try {
        const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        try {
            const metadata = await sharp(buffer).metadata();
            const originalAspectRatio = metadata.width / metadata.height;
            let newWidth, newHeight;

            // Determine the dimensions to meet the specific requirements
            if (metadata.width >= metadata.height) {
                newWidth = 512;
                newHeight = Math.round(newWidth / originalAspectRatio);
            } else {
                newHeight = 462; // 512 - 50 to account for the transparent space
                newWidth = Math.round(newHeight * originalAspectRatio);
            }

            // Ensure the height does not exceed 432 after adding the transparent space
            if (newHeight > 462) {
                newHeight = 462;
                newWidth = Math.round(newHeight * originalAspectRatio);
            }

            // process and resize buffer, then add transparent space
            return sharp(buffer)
                .resize(newWidth, newHeight, {
                    fit: sharp.fit.fill,
                    withoutEnlargement: false
                })
                .extend({
                    top: 0,
                    bottom: 50,
                    left: 0,
                    right: 0,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toBuffer();
        } catch (err) {
            if (err.message.includes('unsupported image format')) {
                console.error('Unsupported image format:', err);
                ctx.reply('Sorry, the provided image format is not supported.');
            } else {
                console.error('Error processing the image:', err);
                ctx.reply('There was an error processing your image.');
            }
        }
    } catch (err) {
        console.error('Error downloading the image:', err);
        ctx.reply('There was an error downloading your image.');
    }
}

async function processImageContent(ctx) {
    const userId = ctx.from.id;
    let fileId, fileSize, mimeType;

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
    if (fileSize && fileSize > SIZE_LIMIT || mimeType && !mimeType.startsWith('image/')) {

        ctx.reply('The file size exceeds the 50MB limit. Please send a smaller image.');
        return;
    }
    if (mimeType && !mimeType.startsWith('image/')) {
        ctx.reply('Only image files are allowed.');
        return;
    } else {
    
                // Process image and rename the file
                const processedBuffer = await processImage(ctx, fileId, userId);
                if (processedBuffer) {
                    const timestamp = Date.now();
                    // Modify filename format to include userId and timestamp while keeping original extension
                    const fileInfo = await ctx.telegram.getFile(fileId);
                    const fileExtension = path.extname(fileInfo.file_path);
                    const newFilename = `${userId}-${timestamp}${fileExtension}`;
                    // Send processed image as document with new filename
                    ctx.replyWithDocument({ source: processedBuffer, filename: newFilename })
                    .catch(err => {
                        console.error('Error sending the processed image:', err);
                        ctx.reply('There was an error sending your image.');
                    });
                }
            }
        }
        
        async function processStickerMessage(ctx) {
            const { sticker, from } = ctx.message;
            const userId = from.id;
            const timestamp = Date.now();
        
            try {
                const fileInfo = await ctx.telegram.getFile(sticker.file_id);
                const fileExtension = path.extname(fileInfo.file_path); 
        
                if (fileExtension !== '.webm') {
                    const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
                    const response = await axios({ url: fileLink, responseType: 'arraybuffer' });
                    const buffer = Buffer.from(response.data, 'binary');
        
                    const processedBuffer = await sharp(buffer)
                        .metadata()
                        .then(metadata => {
                            let newHeight = metadata.height;
                            let newWidth = metadata.width;
                            const maxHeight = 462;
        
                            if (newHeight > maxHeight) {
                                const aspectRatio = metadata.width / metadata.height;
                                newHeight = maxHeight;
                                newWidth = Math.round(newHeight * aspectRatio);
                            }
        
                            return sharp(buffer)
                                .resize(newWidth, newHeight, {
                                    fit: sharp.fit.inside,
                                    withoutEnlargement: true
                                })
                                .extend({
                                    top: 0,
                                    bottom: 50,
                                    left: 0,
                                    right: 0,
                                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                                })
                                .toBuffer();
                        });
        
                    const originalFilename = `${userId}-${timestamp}${fileExtension}`;
                    const savedFilePath = path.join(tempDir, originalFilename);
                    fs.writeFileSync(savedFilePath, processedBuffer);
        
                    await ctx.replyWithDocument({ source: fs.createReadStream(savedFilePath), filename: originalFilename });
                } else {
                    ctx.reply('Animated sticker support SOOOOOON.');
                }
            } catch (err) {
                console.error('There was an error processing your sticker:', err);
                ctx.reply('There was an error processing your sticker.');
            }
        }
        
        module.exports = { processImageContent, processStickerMessage };
