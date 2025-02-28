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
    handleCancel
} from './commandHandlers.js';

// Load environment variables
dotenv.config();

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Register command handlers
bot.start(handleStart);
bot.help(handleHelp);
bot.command('cancel', handleCancel);

// Register message handlers
bot.on('callback_query', handleCallback);
bot.on(['photo', 'document'], handlePhotoDocument);
bot.on('sticker', handleSticker);
bot.on('text', handleText);

// Add error handler
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('An error occurred. Please try again or restart with /start.');
});

// Launch bot
bot.launch();
console.log('Bot is running');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));