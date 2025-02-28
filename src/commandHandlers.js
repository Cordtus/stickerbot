// commandHandlers.js

import { getSession } from './sessionManager.js';
import { logWithContext } from './logger.js';

// Handle /start command
function handleStart(ctx) {
    logWithContext('handleStart', `User ${ctx.from.id} started bot`);
    
    const session = getSession(ctx.chat.id);
    
    // Clear any existing session state
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
    const session = getSession(ctx.chat.id);
    logWithContext('handleHelp', `User ${ctx.from.id} requested help, current mode: ${session.mode}`);
    
    // Basic help message
    let helpText = 'This bot helps you convert images into Telegram stickers and emojis.\n\n' +
        'Available commands:\n' +
        '/start - Start the bot and select a mode\n' +
        '/help - Show this help message\n' +
        '/cancel - Cancel current operation\n\n' +
        'Available modes:\n' +
        '• Icon Format - Convert images to 100x100px format for Telegram emojis\n' +
        '• Sticker Format - Convert images to 512x512px with transparent buffer\n' +
        '• Sticker Packs - Create and manage your own sticker packs';
    
    // Add context-sensitive help if in a specific mode
    if (session.mode === 'icon') {
        helpText += '\n\nYou are currently in Icon Format mode. Send any image to convert it to 100x100px format.';
    } else if (session.mode === 'sticker') {
        helpText += '\n\nYou are currently in Sticker Format mode. Send any image to convert it to 512x512px with a transparent buffer.';
    } else if (session.mode === 'packs') {
        helpText += '\n\nYou are currently in Sticker Pack Management mode.';
        
        if (session.packCreationStep === 'awaiting_name') {
            helpText += ' Enter a name for your new sticker pack.';
        } else if (session.packCreationStep === 'waiting_first_sticker') {
            helpText += ` Send your first sticker image to create the pack "${session.packTitle}".`;
        } else if (session.packCreationStep === 'adding_stickers') {
            helpText += ` You are currently adding stickers to pack "${session.currentPackName}". Send images to add as stickers.`;
        } else if (session.packCreationStep === 'awaiting_external_pack') {
            helpText += ' Send a sticker or link to add an external pack to your collection.';
        }
    }
    
    return ctx.reply(helpText, {
        reply_markup: session.mode === 'packs' ? {
            inline_keyboard: [
                [{ text: 'Return to Pack Management', callback_data: 'select_packs' }]
            ]
        } : undefined
    });
}

// Handle /cancel command
function handleCancel(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleCancel', `User ${ctx.from.id} canceled operation, was in mode: ${session.mode}, step: ${session.packCreationStep}`);
    
    // Store current state for better feedback
    const wasInPackMode = session.mode === 'packs';
    const packName = session.currentPackName;
    
    // Reset pack-specific state
    session.packCreationStep = null;
    session.currentPackName = null;
    
    if (wasInPackMode) {
        // Keep user in packs mode but return to main pack menu
        return ctx.reply('Operation cancelled.', {
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

// Handle /status command to show current state
function handleStatus(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleStatus', `User ${ctx.from.id} requested status`);
    
    let statusText = 'Current bot status:\n';
    
    if (!session.mode) {
        statusText += '• No mode selected. Use /start to select a mode.';
        return ctx.reply(statusText);
    }
    
    statusText += `• Mode: ${session.mode}\n`;
    
    if (session.mode === 'packs') {
        statusText += `• Pack step: ${session.packCreationStep || 'None'}\n`;
        
        if (session.currentPackName) {
            statusText += `• Current pack: ${session.currentPackName}\n`;
        }
        
        if (session.packTitle) {
            statusText += `• Pack title: ${session.packTitle}\n`;
        }
    }
    
    return ctx.reply(statusText, {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
            ]
        }
    });
}

export {
    handleStart,
    handleHelp,
    handleCancel,
    handleStatus
};