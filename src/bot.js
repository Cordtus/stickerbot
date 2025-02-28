// bot.js

import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

// Import modules
import { handleCallback } from './callbackHandlers.js';
import { 
    handlePhotoDocument, 
    handleSticker, 
    handleText 
} from './messageHandlers.js';
import {
    handleStart,
    handleHelp,
    handleCancel,
    handleStatus
} from './commandHandlers.js';
import { initDatabase } from './databaseManager.js';
import { logWithContext } from './logger.js';
import { cleanupOldFiles } from './fileHandler.js';
import { tempDir } from './utils.js';

// Load environment variables
dotenv.config();

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Initialize database
initDatabase().catch(err => {
    logWithContext('bot', 'Failed to initialize database', err);
    process.exit(1);
});

// Schedule temp file cleanup to run every hour
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const MAX_FILE_AGE = 6; // hours

setInterval(() => {
    logWithContext('bot', 'Running scheduled temp file cleanup');
    cleanupOldFiles(tempDir, MAX_FILE_AGE);
}, CLEANUP_INTERVAL);

// Run initial cleanup at startup
cleanupOldFiles(tempDir, MAX_FILE_AGE);

// Register command handlers
bot.start(handleStart);
bot.help(handleHelp);
bot.command('cancel', handleCancel);
bot.command('status', handleStatus);

// Register message handlers
bot.on('callback_query', handleCallback);
bot.on(['photo', 'document'], handlePhotoDocument);
bot.on('sticker', handleSticker);
bot.on('text', handleText);

// Add error handler
bot.catch((err, ctx) => {
    logWithContext('bot', `Error for ${ctx.updateType}`, err);
    ctx.reply('An error occurred. Please try again or restart with /start.');
});

// Launch bot
bot.launch();
logWithContext('bot', 'Bot is running');

// Enable graceful stop
process.once('SIGINT', () => {
    logWithContext('bot', 'Received SIGINT, stopping bot');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    logWithContext('bot', 'Received SIGTERM, stopping bot');
    bot.stop('SIGTERM');
});