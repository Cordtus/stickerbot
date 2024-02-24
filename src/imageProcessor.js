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
