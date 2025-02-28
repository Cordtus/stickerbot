// commandHandlers.js

import { getSession } from './sessionManager.js';

// Handle /start command
function handleStart(ctx) {
    const session = getSession(ctx.chat.id);
    session.lastAction = null;
    session.mode = null;
    session.currentPackName = null;
    session.packCreationStep = null;
    
    return ctx.reply('Welcome! Please select a mode for image conversion:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Icon Format (100x100)', callback_data: 'select_icon' }],
                [{ text: 'Sticker Format (512x512 with buffer)', callback_data: 'select_sticker' }],
                [{ text: 'Manage Sticker Packs', callback_data: 'select_packs' }]
            ]
        }
    });
}

// Handle /help command
function handleHelp(ctx) {
    return ctx.reply(
        'This bot helps you convert images into Telegram stickers and emojis.\n\n' +
        'Available commands:\n' +
        '/start - Start the bot and select a mode\n' +
        '/help - Show this help message\n\n' +
        'Available modes:\n' +
        '• Icon Format - Convert images to 100x100px format for Telegram emojis\n' +
        '• Sticker Format - Convert images to 512x512px with transparent buffer\n' +
        '• Sticker Packs - Create and manage your own sticker packs'
    );
}

// Handle /cancel command
function handleCancel(ctx) {
    const session = getSession(ctx.chat.id);
    session.packCreationStep = null;
    session.currentPackName = null;
    
    if (session.mode === 'packs') {
        return ctx.reply('Operation cancelled. What would you like to do?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Pack Management', callback_data: 'select_packs' }],
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                ]
            }
        });
    }
    
    return ctx.reply('Operation cancelled. Use /start to begin again.');
}

export {
    handleStart,
    handleHelp,
    handleCancel
};