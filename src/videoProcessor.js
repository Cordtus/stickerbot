// videoProcessor.js

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ensureTempDirectory, tempDir } from './fileHandler.js';
import { getSystemSpec } from './configurator.js';

// Video processing constraints for Telegram
const VIDEO_CONSTRAINTS = {
	sticker: {
		maxWidth: 512,
		maxHeight: 512,
		maxDuration: 3,
		maxFileSize: 256 * 1024, // 256KB
		format: 'webm',
		codec: 'libvpx-vp9'
	},
	icon: {
		maxWidth: 100,
		maxHeight: 100,
		maxDuration: 3,
		maxFileSize: 256 * 1024, // 256KB (same as sticker per Telegram spec)
		format: 'webm',
		codec: 'libvpx-vp9'
	}
};

// Bot processing limits
const BOT_LIMITS = {
	maxDuration: 6,
	maxFileSize: 50 * 1024 * 1024 // 50MB
};

/**
 * Enhanced logger with context
 * @param {string} context - Log context/source
 * @param {string} message - Log message
 * @param {Error} [error] - Optional error object
 */
function logWithContext(context, message, error = null) {
	const timestamp = new Date().toISOString();
	console.log(`[${timestamp}] [${context}] ${message}`);
	if (error) {
		console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
		console.error(error.stack);
	}
}

/**
 * Format metrics for display to user
 * @param {Object} metadata - Processing metadata
 * @returns {Object} Formatted metrics object
 */
function formatMetrics(metadata) {
	if (!metadata) {
		return {
			original: { size: 'Unknown', duration: 'Unknown', fps: 'Unknown', resolution: 'Unknown' },
			final: { size: 'Unknown', duration: 'Unknown', fps: 'Unknown', resolution: 'Unknown' },
			processing: { time: 'Unknown', hardware: 'Unknown', speed: 'Unknown' }
		};
	}

	const formatBytes = (bytes) => {
		if (!bytes) return '0KB';
		const kb = bytes / 1024;
		return kb < 1024 ? `${kb.toFixed(1)}KB` : `${(kb / 1024).toFixed(1)}MB`;
	};

	return {
		original: {
			size: formatBytes(metadata.originalSize || 0),
			duration: `${(metadata.originalDuration || 0).toFixed(2)}s`,
			fps: `${(metadata.originalFps || 0).toFixed(1)} fps`,
			resolution: metadata.originalResolution || 'Unknown'
		},
		final: {
			size: formatBytes(metadata.finalSize || 0),
			duration: `${(metadata.finalDuration || 0).toFixed(2)}s`,
			fps: `${(metadata.finalFps || 30).toFixed(1)} fps`,
			resolution: metadata.finalResolution || 'Unknown'
		},
		processing: {
			time: `${((metadata.processingTime || 0) / 1000).toFixed(1)}s`,
			hardware: metadata.systemOptimized || 'Unknown',
			speed: (metadata.speedMultiplier || 1) > 1 ? `${(metadata.speedMultiplier || 1).toFixed(2)}x faster` : 'Normal speed'
		}
	};
}

/**
 * Check if file is video/GIF based on MIME type
 * @param {string} mimeType - MIME type string
 * @returns {boolean} True if video/GIF
 */
function isVideoFile(mimeType) {
	const videoMimeTypes = [
		'video/mp4',
		'video/mpeg',
		'video/quicktime',
		'video/x-msvideo',
		'video/x-ms-wmv',
		'image/gif',
		'video/webm',
		'video/ogg'
	];

	return videoMimeTypes.includes(mimeType);
}

/**
 * Get video metadata using ffprobe
 * @param {string} filePath - Path to video file
 * @returns {Promise<Object>} Video metadata
 */
function getVideoMetadata(filePath) {
	return new Promise((resolve, reject) => {
		ffmpeg.ffprobe(filePath, (err, data) => {
			if (err) {
				logWithContext('getVideoMetadata', 'Failed to get video metadata', err);
				reject(new Error(`Cannot read video metadata: ${err.message}`));
				return;
			}

			const videoStream = data.streams.find(stream => stream.codec_type === 'video');

			if (!videoStream) {
				reject(new Error('No video stream found'));
				return;
			}

			const duration = parseFloat(data.format.duration) || parseFloat(videoStream.duration) || 0;
			const width = parseInt(videoStream.width) || 0;
			const height = parseInt(videoStream.height) || 0;

			// Parse frame rate from ratio string (e.g., "30/1")
			let frameRate = 30;
			if (videoStream.r_frame_rate) {
				const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
				if (den && den !== 0) {
					frameRate = num / den;
				}
			}

			const metadata = {
				duration,
				width,
				height,
				frameRate: Math.round(frameRate),
				size: parseInt(data.format.size) || 0
			};

			logWithContext('getVideoMetadata', `Video: ${width}x${height}, ${duration.toFixed(2)}s, ${metadata.frameRate}fps`);
			resolve(metadata);
		});
	});
}

/**
 * Run FFmpeg conversion with fluent-ffmpeg
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path
 * @param {Object} options - Conversion options
 * @param {function} [onProgress] - Progress callback (0-100)
 * @returns {Promise<string>} Output file path
 */
function runFFmpegConversion(inputPath, outputPath, options, onProgress = null) {
	return new Promise((resolve, reject) => {
		const {
			width,
			height,
			crf = 30,
			speedFilter = null,
			padToExact = false // For emoji mode: pad with transparency to exact dimensions
		} = options;

		// Build video filter string
		let videoFilters;
		if (padToExact) {
			// For emoji: scale to fit inside dimensions (preserve aspect ratio), then pad to exact size
			// The pad filter centers the video and fills with transparent black
			videoFilters = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,fps=30`;
		} else {
			// For stickers: just scale to target dimensions
			videoFilters = `scale=${width}:${height},fps=30`;
		}

		if (speedFilter) {
			videoFilters += `,setpts=PTS/${speedFilter}`;
		}

		logWithContext('runFFmpeg', `Converting: ${width}x${height}, CRF ${crf}, padToExact=${padToExact}, filters: ${videoFilters}`);

		const command = ffmpeg(inputPath)
			.outputOptions([
				'-c:v libvpx-vp9',
				`-crf ${crf}`,
				'-b:v 0',
				'-deadline good',
				'-cpu-used 5',
				'-row-mt 1',
				'-an',
				'-pix_fmt yuva420p' // Ensure alpha channel support for transparency
			])
			.videoFilters(videoFilters)
			.format('webm')
			.output(outputPath);

		// Progress handler
		if (onProgress) {
			command.on('progress', (progress) => {
				const percent = progress.percent || 0;
				onProgress(Math.min(Math.round(percent), 100));
			});
		}

		// Timeout after 90 seconds
		const timeout = setTimeout(() => {
			command.kill('SIGKILL');
			reject(new Error('FFmpeg processing timeout (90 seconds)'));
		}, 90000);

		command
			.on('start', (cmdLine) => {
				logWithContext('runFFmpeg', `Executing: ${cmdLine}`);
			})
			.on('error', (err) => {
				clearTimeout(timeout);
				logWithContext('runFFmpeg', 'FFmpeg error', err);
				reject(new Error(`FFmpeg processing failed: ${err.message}`));
			})
			.on('end', () => {
				clearTimeout(timeout);
				if (fs.existsSync(outputPath)) {
					const stats = fs.statSync(outputPath);
					logWithContext('runFFmpeg', `Success: ${stats.size} bytes`);
					resolve(outputPath);
				} else {
					reject(new Error('FFmpeg completed but output file not found'));
				}
			})
			.run();
	});
}

/**
 * Fetch video file from Telegram
 * @param {Object} ctx - Telegraf context
 * @param {string} fileId - Telegram file ID
 * @returns {Promise<string>} Downloaded file path
 */
async function downloadVideoFile(ctx, fileId) {
	const timestamp = Date.now();
	const randomSuffix = Math.random().toString(36).substring(2, 8);
	const tempFilePath = path.join(tempDir, `download-${timestamp}-${randomSuffix}`);

	try {
		ensureTempDirectory();

		const fileInfo = await ctx.telegram.getFile(fileId);
		const fileSize = fileInfo.file_size;

		logWithContext('downloadVideoFile', `Downloading ${Math.round(fileSize / 1024)}KB to ${tempFilePath}`);

		if (fileSize > BOT_LIMITS.maxFileSize) {
			throw new Error(`File too large: ${Math.round(fileSize / 1024 / 1024)}MB (max: ${BOT_LIMITS.maxFileSize / 1024 / 1024}MB)`);
		}

		const fileUrl = await ctx.telegram.getFileLink(fileId);
		const response = await axios({
			method: 'GET',
			url: fileUrl,
			responseType: 'stream',
			timeout: 60000
		});

		const writer = fs.createWriteStream(tempFilePath);
		response.data.pipe(writer);

		await new Promise((resolve, reject) => {
			writer.on('finish', resolve);
			writer.on('error', reject);

			const dlTimeout = setTimeout(() => {
				writer.destroy();
				reject(new Error('Download timeout'));
			}, 60000);

			writer.on('finish', () => clearTimeout(dlTimeout));
			writer.on('error', () => clearTimeout(dlTimeout));
		});

		logWithContext('downloadVideoFile', `Download completed: ${tempFilePath}`);
		return tempFilePath;
	} catch (err) {
		if (fs.existsSync(tempFilePath)) {
			fs.unlinkSync(tempFilePath);
		}
		throw new Error(`Download failed: ${err.message}`);
	}
}

/**
 * Main video processing function
 * @param {Object} ctx - Telegraf context
 * @param {string} fileId - Telegram file ID
 * @param {string} [mode='sticker'] - Processing mode ('sticker', 'icon', 'packs')
 * @param {function} [onProgress] - Progress callback (0-100)
 * @returns {Promise<Object>} Processing result with filePath and metadata
 */
async function processVideo(ctx, fileId, mode = 'sticker', onProgress = null) {
	const startTime = Date.now();
	let inputPath = null;
	let outputPath = null;

	try {
		const capabilities = await getSystemSpec();

		if (!capabilities.ffmpeg.available) {
			throw new Error('FFmpeg is not available on this system');
		}

		logWithContext('processVideo', `Processing video ${fileId} in ${mode} mode`);

		// Download video
		inputPath = await downloadVideoFile(ctx, fileId);

		// Get metadata
		const metadata = await getVideoMetadata(inputPath);

		// Check constraints - use 'sticker' constraints for 'packs' mode
		const constraintKey = mode === 'icon' ? 'icon' : 'sticker';
		const constraints = VIDEO_CONSTRAINTS[constraintKey];

		if (metadata.duration > BOT_LIMITS.maxDuration) {
			throw new Error(`Video duration (${metadata.duration.toFixed(1)}s) exceeds limit (${BOT_LIMITS.maxDuration}s)`);
		}

		// Calculate proper dimensions based on mode
		let targetWidth, targetHeight;
		let padToExact = false;

		if (mode === 'icon') {
			// Emoji mode: scale to fit inside 100x100, then pad to exactly 100x100
			// The actual scaling happens in FFmpeg filter, we just set target dimensions
			targetWidth = constraints.maxWidth;
			targetHeight = constraints.maxHeight;
			padToExact = true;
		} else {
			// Sticker/packs mode: one dimension must be exactly 512, other <= 512
			if (metadata.width >= metadata.height) {
				targetWidth = 512;
				targetHeight = Math.round((metadata.height / metadata.width) * 512);
			} else {
				targetHeight = 512;
				targetWidth = Math.round((metadata.width / metadata.height) * 512);
			}

			targetWidth = Math.min(targetWidth, 512);
			targetHeight = Math.min(targetHeight, 512);
		}

		// Calculate target duration and speed adjustment
		const targetDuration = Math.min(metadata.duration, constraints.maxDuration);

		let speedFilter = null;
		if (metadata.duration > constraints.maxDuration) {
			const speedMultiplier = metadata.duration / constraints.maxDuration;
			if (speedMultiplier > 1.1) {
				speedFilter = speedMultiplier.toFixed(2);
				logWithContext('processVideo', `Applying ${speedMultiplier.toFixed(2)}x speed increase`);
			}
		}

		// Generate output path
		const timestamp = Date.now();
		outputPath = path.join(tempDir, `processed-${timestamp}.webm`);

		// Initial conversion attempt with CRF 30
		await runFFmpegConversion(inputPath, outputPath, {
			width: targetWidth,
			height: targetHeight,
			crf: 30,
			speedFilter,
			padToExact
		}, onProgress);

		// Check output size and retry with higher compression if needed
		let outputStats = fs.statSync(outputPath);

		if (outputStats.size > constraints.maxFileSize) {
			logWithContext('processVideo', `Output too large (${outputStats.size} bytes), trying CRF 40`);
			fs.unlinkSync(outputPath);

			await runFFmpegConversion(inputPath, outputPath, {
				width: targetWidth,
				height: targetHeight,
				crf: 40,
				speedFilter,
				padToExact
			}, onProgress);

			outputStats = fs.statSync(outputPath);
		}

		if (outputStats.size > constraints.maxFileSize) {
			logWithContext('processVideo', `Still too large (${outputStats.size} bytes), trying CRF 50`);
			fs.unlinkSync(outputPath);

			await runFFmpegConversion(inputPath, outputPath, {
				width: targetWidth,
				height: targetHeight,
				crf: 50,
				speedFilter,
				padToExact
			}, onProgress);

			outputStats = fs.statSync(outputPath);
		}

		if (outputStats.size > constraints.maxFileSize) {
			throw new Error(`Video file too large even after compression: ${Math.round(outputStats.size / 1024)}KB (max: ${Math.round(constraints.maxFileSize / 1024)}KB)`);
		}

		const processingTime = Date.now() - startTime;
		const outputSize = outputStats.size;

		// For emoji mode, final resolution is always 100x100 due to padding
		const finalResolution = padToExact
			? `${targetWidth}x${targetHeight}`
			: `${targetWidth}x${targetHeight}`;

		logWithContext('processVideo', `Completed: ${Math.round(outputSize / 1024)}KB output in ${processingTime}ms`);

		return {
			success: true,
			filePath: outputPath,
			filename: `processed_video_${mode}.webm`,
			metadata: {
				originalSize: fs.statSync(inputPath).size,
				finalSize: outputSize,
				processingTime,
				originalDuration: metadata.duration,
				finalDuration: targetDuration,
				originalFps: metadata.frameRate,
				finalFps: 30,
				originalResolution: `${metadata.width}x${metadata.height}`,
				finalResolution,
				systemOptimized: capabilities.summary.optimizedFor,
				speedMultiplier: metadata.duration > constraints.maxDuration ?
					metadata.duration / constraints.maxDuration : 1,
				compressionRatio: (fs.statSync(inputPath).size / outputSize).toFixed(2)
			},
			cleanup: () => {
				if (inputPath && fs.existsSync(inputPath)) {
					fs.unlinkSync(inputPath);
					logWithContext('processVideo', `Cleaned up input file: ${inputPath}`);
				}
			}
		};

	} catch (err) {
		// Cleanup on error
		if (inputPath && fs.existsSync(inputPath)) {
			fs.unlinkSync(inputPath);
		}
		if (outputPath && fs.existsSync(outputPath)) {
			fs.unlinkSync(outputPath);
		}

		logWithContext('processVideo', 'Video processing failed', err);
		throw err;
	}
}

export {
	processVideo,
	getVideoMetadata,
	downloadVideoFile,
	formatMetrics,
	isVideoFile,
	VIDEO_CONSTRAINTS,
	BOT_LIMITS
};
