// callbackHandlers.js

import { getSession } from './sessionManager.js';
import { 
    getUserStickerSets, 
    createStickerSet, 
    generateStickerSetName 
} from './stickerManager.js';

// Handle initial mode selection callbacks
async function handleModeSelection(ctx) {
    const session = getSession(ctx.chat.id);
    const action = ctx.callbackQuery.data;

    if (action === 'select_icon') {
        session.mode = 'icon';
        return ctx.reply('You have selected Icon Format. Please send one or more images to convert.');
    } 
    
    if (action === 'select_sticker') {
        session.mode = 'sticker';
        return ctx.reply('You have selected Sticker Format. Please send one or more images to convert.');
    }
    
    if (action === 'select_packs') {
        session.mode = 'packs';
        return handlePacksMode(ctx);
    }
    
    return false; // Not handled here
}

// Handle post-processing callbacks
async function handlePostProcessCallbacks(ctx) {
    const session = getSession(ctx.chat.id);
    const action = ctx.callbackQuery.data;
    
    if (action === 'start_over') {
        session.mode = null;
        session.lastAction = null;
        session.currentPackName = null;
        session.packCreationStep = null;
        
        return ctx.reply('Please select a mode for image conversion:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Icon Format (100x100)', callback_data: 'select_icon' }],
                    [{ text: 'Sticker Format (512x512 with buffer)', callback_data: 'select_sticker' }],
                    [{ text: 'Manage Sticker Packs', callback_data: 'select_packs' }]
                ]
            }
        });
    }
    
    if (action === 'convert_more') {
        if (session.mode === 'icon') {
            return ctx.reply('You are still in Icon Format mode. Please send more images to convert.');
        } 
        
        if (session.mode === 'sticker') {
            return ctx.reply('You are still in Sticker Format mode. Please send more images to convert.');
        }
    }
    
    return false; // Not handled here
}

// Handle sticker pack management callbacks
async function handlePacksMode(ctx) {
    const session = getSession(ctx.chat.id);
    session.mode = 'packs';
    
    return ctx.reply('Sticker Pack Management', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                [{ text: 'Add to Existing Pack', callback_data: 'list_packs' }],
                [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
            ]
        }
    });
}

// Handle sticker pack creation and management callbacks
async function handlePackCallbacks(ctx) {
    const session = getSession(ctx.chat.id);
    const action = ctx.callbackQuery.data;
    
    // Create new pack
    if (action === 'create_pack') {
        session.packCreationStep = 'awaiting_name';
        return ctx.reply('Please enter a name for your new sticker pack:');
    }
    
    // List user's existing packs
    if (action === 'list_packs') {
        const userId = ctx.from.id;
        const userPacks = await getUserStickerSets(userId);
        
        if (userPacks.length === 0) {
            return ctx.reply('You don\'t have any sticker packs yet. Create one first.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                    ]
                }
            });
        }
        
        // Create keyboard with user's packs
        const keyboard = userPacks.map(pack => (
            [{ text: pack.title, callback_data: `select_pack:${pack.name}` }]
        ));
        
        // Add navigation button
        keyboard.push([{ text: 'Return to Pack Management', callback_data: 'select_packs' }]);
        
        return ctx.reply('Select a sticker pack to add stickers to:', {
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    // Handle specific pack selection
    if (action.startsWith('select_pack:')) {
        const packName = action.split(':')[1];
        session.currentPackName = packName;
        session.packCreationStep = 'adding_stickers';
        
        return ctx.reply(`Selected pack "${packName}". Send stickers or images to add to this pack.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Finish Adding Stickers', callback_data: 'finish_adding' }]
                ]
            }
        });
    }
    
    // Handle completion of adding stickers
    if (action === 'finish_adding') {
        session.packCreationStep = null;
        session.currentPackName = null;
        
        return ctx.reply('Sticker pack updated! What would you like to do next?', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Return to Pack Management', callback_data: 'select_packs' }],
                    [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                ]
            }
        });
    }
    
    return false; // Not handled here
}

// Main callback handler
async function handleCallback(ctx) {
    try {
        // Try each handler in sequence
        const handlers = [
            handleModeSelection,
            handlePostProcessCallbacks,
            handlePackCallbacks
        ];
        
        for (const handler of handlers) {
            const result = await handler(ctx);
            if (result !== false) {
                return;
            }
        }
        
        // If we got here, no handler matched
        ctx.reply('Invalid selection.');
    } catch (error) {
        console.error('Error handling callback:', error);
        ctx.reply(`Error: ${error.message}`);
    }
}

export { 
    handleCallback,
    handleModeSelection,
    handlePostProcessCallbacks,
    handlePacksMode,
    handlePackCallbacks
};