// animatedStickerProcessor.js

import fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';
import { logWithContext } from './logger.js';
import { getTempPath, generateUniqueFilename } from './utils.js';
import { createTempFileFromBuffer, safeDeleteFile } from './fileHandler.js';

const TGS_SIZE_LIMIT = 64 * 1024; // 64 KB for TGS files
const WEBM_SIZE_LIMIT = 256 * 1024; // 256 KB for WebM files

/**
 * Validate TGS file (compressed Lottie animation)
 * @param {Buffer} buffer - TGS file buffer
 * @returns {boolean} Whether the file is valid
 */
async function validateTgsFile(buffer) {
    try {
        // Check file size
        if (buffer.length > TGS_SIZE_LIMIT) {
            logWithContext('animatedStickerProcessor', `TGS file too large: ${buffer.length} bytes (max: ${TGS_SIZE_LIMIT} bytes)`);
            return false;
        }
        
        // TGS should start with gzip magic bytes (0x1F, 0x8B)
        if (buffer[0] !== 0x1F || buffer[1] !== 0x8B) {
            logWithContext('animatedStickerProcessor', 'Invalid TGS file: missing gzip header');
            return false;
        }
        
        // Further validation would require decompressing and parsing the JSON,
        // which we can add if needed
        
        return true;
    } catch (err) {
        logWithContext('animatedStickerProcessor', 'Error validating TGS file', err);
        return false;
    }
}

/**
 * Validate WebM video file for video stickers
 * @param {Buffer} buffer - WebM file buffer
 * @returns {Promise<object>} Validation result with metadata
 */
async function validateWebmFile(buffer) {
    try {
        // Create a temporary file
        const tempFilePath = getTempPath(generateUniqueFilename('validate', 'webm'));
        fs.writeFileSync(tempFilePath, buffer);
        
        // Use ffprobe to get video info
        const ffprobeOutput = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,duration,r_frame_rate -of json "${tempFilePath}"`, 
            { encoding: 'utf8' });
        
        // Clean up temp file
        safeDeleteFile(tempFilePath);
        
        const videoInfo = JSON.parse(ffprobeOutput);
        const stream = videoInfo.streams[0];
        
        if (!stream) {
            logWithContext('animatedStickerProcessor', 'No video stream found in WebM file');
            return { valid: false, reason: 'No video stream found' };
        }
        
        // Extract metadata
        const width = parseInt(stream.width);
        const height = parseInt(stream.height);
        const codec = stream.codec_name;
        const duration = parseFloat(stream.duration);
        
        // Parse framerate (comes as a fraction like "30/1")
        const frameRateParts = stream.r_frame_rate.split('/');
        const frameRate = parseInt(frameRateParts[0]) / parseInt(frameRateParts[1]);
        
        // Check requirements
        const checks = [
            { condition: codec === 'vp9', reason: 'Video codec must be VP9' },
            { condition: buffer.length <= WEBM_SIZE_LIMIT, reason: `File too large (${buffer.length} bytes, max: ${WEBM_SIZE_LIMIT} bytes)` },
            { condition: duration <= 3, reason: `Duration too long (${duration}s, max: 3s)` },
            { condition: frameRate <= 30, reason: `Frame rate too high (${frameRate}fps, max: 30fps)` },
            { condition: width <= 512 && height <= 512, reason: `Dimensions too large (${width}x${height}, max: 512x512)` }
        ];
        
        for (const check of checks) {
            if (!check.condition) {
                logWithContext('animatedStickerProcessor', `WebM validation failed: ${check.reason}`);
                return { valid: false, reason: check.reason };
            }
        }
        
        return { 
            valid: true, 
            metadata: { 
                width, 
                height, 
                codec, 
                duration, 
                frameRate 
            }
        };
    } catch (err) {
        logWithContext('animatedStickerProcessor', 'Error validating WebM file', err);
        return { valid: false, reason: 'File analysis error' };
    }
}

/**
 * Process TGS file into Telegram-compatible format
 * @param {Buffer} buffer - TGS file buffer
 * @param {number|string} userId - User ID
 * @returns {Promise<string>} Path to processed file
 */
async function processTgsFile(buffer, userId) {
    try {
        // Validate TGS file
        const isValid = await validateTgsFile(buffer);
        if (!isValid) {
            throw new Error('Invalid TGS file. Animated stickers must be in Telegram\'s TGS format.');
        }
        
        // For TGS files, we don't need to process them further
        const filePath = createTempFileFromBuffer(buffer, userId, 'animated', 'tgs');
        
        logWithContext('animatedStickerProcessor', `TGS file processed successfully: ${filePath}`);
        return filePath;
    } catch (err) {
        logWithContext('animatedStickerProcessor', 'Error processing TGS file', err);
        throw err;
    }
}

/**
 * Process WebM file into Telegram-compatible video sticker
 * @param {Buffer} buffer - WebM file buffer
 * @param {number|string} userId - User ID
 * @returns {Promise<string>} Path to processed file
 */
async function processWebmFile(buffer, userId) {
    try {
        // Validate WebM file
        const validation = await validateWebmFile(buffer);
        if (!validation.valid) {
            throw new Error(`Invalid WebM file: ${validation.reason}. Video stickers must be VP9 codec, max 3s, max 30fps, max 512x512px.`);
        }
        
        // Create temporary input file
        const inputPath = getTempPath(generateUniqueFilename('input', 'webm', userId));
        fs.writeFileSync(inputPath, buffer);
        
        // Output file path
        const outputPath = getTempPath(generateUniqueFilename('video', 'webm', userId));
        
        // Process with ffmpeg to ensure compliance
        execSync(`ffmpeg -i "${inputPath}" -c:v libvpx-vp9 -crf 30 -b:v 200k -vf "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease" -an -t 3 "${outputPath}"`, 
            { stdio: 'pipe' });
        
        // Clean up input file
        safeDeleteFile(inputPath);
        
        logWithContext('animatedStickerProcessor', `WebM file processed successfully: ${outputPath}`);
        return outputPath;
    } catch (err) {
        logWithContext('animatedStickerProcessor', 'Error processing WebM file', err);
        throw err;
    }
}

/**
 * Download animated sticker from Telegram
 * @param {object} ctx - Telegram context
 * @param {string} fileId - File ID
 * @returns {Promise<object>} Downloaded file info
 */
async function downloadAnimatedSticker(ctx, fileId) {
    try {
        const fileInfo = await ctx.telegram.getFile(fileId);
        const fileLink = await ctx.telegram.getFileLink(fileId);
        
        logWithContext('animatedStickerProcessor', `Downloading animated sticker: ${fileLink}`);
        
        const response = await axios({
            url: fileLink,
            responseType: 'arraybuffer',
            timeout: 30000
        });
        
        const buffer = Buffer.from(response.data);
        
        return {
            buffer,
            fileInfo,
            isTgs: fileInfo.file_path.endsWith('.tgs'),
            isWebm: fileInfo.file_path.endsWith('.webm')
        };
    } catch (err) {
        logWithContext('animatedStickerProcessor', 'Error downloading animated sticker', err);
        throw err;
    }
}

/**
 * Process animated sticker from Telegram
 * @param {object} ctx - Telegram context
 * @param {string} fileId - File ID
 * @returns {Promise<object>} Processing result
 */
async function processAnimatedSticker(ctx, fileId) {
    try {
        const userId = ctx.from.id;
        const download = await downloadAnimatedSticker(ctx, fileId);
        
        if (download.isTgs) {
            const filePath = await processTgsFile(download.buffer, userId);
            return {
                success: true,
                filePath,
                type: 'animated',
                format: 'tgs'
            };
        } else if (download.isWebm) {
            const filePath = await processWebmFile(download.buffer, userId);
            return {
                success: true,
                filePath,
                type: 'video',
                format: 'webm'
            };
        } else {
            throw new Error('Unsupported animated sticker format. Only TGS and WebM are supported.');
        }
    } catch (err) {
        logWithContext('animatedStickerProcessor', 'Error processing animated sticker', err);
        return {
            success: false,
            error: err.message
        };
    }
}

export {
    processTgsFile,
    processWebmFile,
    processAnimatedSticker,
    validateTgsFile,
    validateWebmFile
};