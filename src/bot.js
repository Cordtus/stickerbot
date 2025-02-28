// bot.js

import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

// Load environment variables
dotenv.config();

// Enhanced logger
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

// Ensure data directory exists
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Initialize database
initDatabase().catch(err => {
    logWithContext('bot', 'Failed to initialize database', err);
    process.exit(1);
});

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