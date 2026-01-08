// commandHandlers.js

import { getSession } from './sessionManager.js';
import { getSystemSpec } from './configurator.js';

// Enhanced logger
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

// Handle /start command
async function handleStart(ctx) {
    logWithContext('handleStart', `User ${ctx.from.id} started bot`);

    const session = getSession(ctx.chat.id);
    
    // Clear session state
    Object.assign(session, {
        lastAction: null,
        mode: null,
        currentPackName: null,
        packCreationStep: null
    });

    return ctx.reply('Please select a mode:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Icon Format (100x100)', callback_data: 'select_icon' }],
                [{ text: 'Sticker Format (512x512)', callback_data: 'select_sticker' }],
                [{ text: 'Manage Sticker Packs', callback_data: 'select_packs' }]
            ]
        }
    });
}

// Handle /help command
async function handleHelp(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleHelp', `User ${ctx.from.id} requested help, current mode: ${session.mode}`);

    try {
        const spec = await getSystemSpec();
        const hasVideo = spec && spec.ffmpeg.available;

        let helpText = 'This bot converts media into Telegram-compatible formats.\n\n' +
                      'Commands:\n' +
                      '/start - Select a mode\n' +
                      '/help - Show this help\n' +
                      '/cancel - Cancel current operation\n' +
                      '/status - Show current status\n\n' +
                      'Modes:\n' +
                      '• Icon Format - 100x100px for emojis\n' +
                      '• Sticker Format - 512x512px for stickers\n' +
                      '• Sticker Packs - Create and manage packs\n\n' +
                      'Supported formats:\n' +
                      '• Images: JPEG, PNG, WebP\n';

        if (hasVideo) {
            helpText += '• Videos: MP4, MOV, AVI, WebM (max 6 seconds)\n' +
                       '• GIFs: Animated GIFs (max 6 seconds)\n';
        }

        helpText += '\nFile limit: 50MB maximum';

        // Add context-sensitive help
        if (session.mode === 'icon') {
            helpText += '\n\nCurrently in Icon Format mode. Send media to convert to 100x100px.';
        } else if (session.mode === 'sticker') {
            helpText += '\n\nCurrently in Sticker Format mode. Send media to convert to 512x512px.';
        } else if (session.mode === 'packs') {
            helpText += '\n\nCurrently in Sticker Pack Management mode.';
            
            if (session.packCreationStep === 'awaiting_name') {
                helpText += ' Enter a name for your new pack.';
            } else if (session.packCreationStep === 'waiting_first_sticker') {
                helpText += ` Send your first sticker to create "${session.packTitle}".`;
            } else if (session.packCreationStep === 'adding_stickers') {
                helpText += ` Adding stickers to "${session.currentPackName}".`;
            } else if (session.packCreationStep === 'awaiting_external_pack') {
                helpText += ' Send a sticker or pack link to add to your collection.';
            }
        }

        const replyMarkup = session.mode === 'packs' ? {
            inline_keyboard: [[{ text: 'Return to Pack Management', callback_data: 'select_packs' }]]
        } : undefined;

        return ctx.reply(helpText, { reply_markup: replyMarkup });
        
    } catch (err) {
        logWithContext('handleHelp', 'Error getting system specs', err);
        return ctx.reply('Convert images and videos into Telegram-compatible formats.\n\nCommands: /start, /help, /cancel, /status');
    }
}

// Handle /cancel command
function handleCancel(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleCancel', `User ${ctx.from.id} canceled operation`);

    const wasInPackMode = session.mode === 'packs';
    
    // Reset pack-specific state
    session.packCreationStep = null;
    session.currentPackName = null;

    if (wasInPackMode) {
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

// Handle /status command
async function handleStatus(ctx) {
    const session = getSession(ctx.chat.id);
    logWithContext('handleStatus', `User ${ctx.from.id} requested status`);

    let statusText = 'Current status:\n\n';

    // User session status
    if (!session.mode) {
        statusText += 'No mode selected. Use /start to select a mode.';
    } else {
        statusText += `Mode: ${session.mode}\n`;

        if (session.mode === 'packs') {
            if (session.packCreationStep) {
                statusText += `Step: ${session.packCreationStep}\n`;
            }
            if (session.currentPackName) {
                statusText += `Current pack: ${session.currentPackName}\n`;
            }
            if (session.packTitle) {
                statusText += `Pack title: ${session.packTitle}\n`;
            }
        }

        if (session.isProcessing) {
            statusText += `Processing: ${session.processingType || 'Active'}\n`;
        }
    }

    return ctx.reply(statusText, {
        reply_markup: {
            inline_keyboard: [[{ text: 'Return to Main Menu', callback_data: 'start_over' }]]
        }
    });
}

export {
    handleStart,
    handleHelp,
    handleCancel,
    handleStatus
};