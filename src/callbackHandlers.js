// callbackHandlers.js

import { getSession } from './sessionManager.js';
import { 
    getUserStickerSets, 
    createStickerSet, 
    generateStickerSetName,
    canUserEditPack 
} from './stickerManager.js';
import {
    toggleFavoritePack,
    removeUserPack,
    getStickerPackByName
} from './databaseManager.js';

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
          [{ text: 'Add External Pack', callback_data: 'add_external_pack' }],
          [{ text: 'My Packs', callback_data: 'my_packs' }],
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
        
    // Add External Pack
    if (action === 'add_external_pack') {
        session.packCreationStep = 'awaiting_external_pack';
        return ctx.reply('Please send a link to the sticker pack (e.g., https://t.me/addstickers/YourPackName) or forward a sticker from the pack you want to add.');
    }

    // List user's existing packs
    if (action === 'list_packs') {
        const userId = ctx.from.id;
        const userPacks = await getUserStickerSets(ctx);
        
        // Filter to only include packs the user can edit
        const editablePacks = userPacks.filter(pack => pack.can_edit);
        
        if (editablePacks.length === 0) {
            return ctx.reply('You don\'t have any sticker packs you can edit yet. Create one first.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                    ]
                }
            });
        }
        
        // Create keyboard with user's packs
        const keyboard = editablePacks.map(pack => (
            [{ text: pack.title, callback_data: `select_pack:${pack.name}` }]
        ));
        
        // Add navigation button
        keyboard.push([{ text: 'Return to Pack Management', callback_data: 'select_packs' }]);
        
        return ctx.reply('Select a sticker pack to add stickers to:', {
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    // View user's packs
    if (action === 'my_packs') {
        const userId = ctx.from.id;
        const userPacks = await getUserStickerSets(ctx);
        
        if (userPacks.length === 0) {
            return ctx.reply('You don\'t have any sticker packs yet. Create one first or add an external pack.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                        [{ text: 'Add External Pack', callback_data: 'add_external_pack' }],
                        [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                    ]
                }
            });
        }
        
        // Create keyboard with user's packs
        const keyboard = userPacks.map(pack => {
            const starSymbol = pack.is_favorite ? '⭐ ' : '';
            const editSymbol = pack.can_edit ? '✏️ ' : '';
            return [{ 
                text: `${starSymbol}${editSymbol}${pack.title}`, 
                callback_data: `view_pack:${pack.name}` 
            }];
        });
        
        // Add navigation button
        keyboard.push([{ text: 'Return to Pack Management', callback_data: 'select_packs' }]);
        
        return ctx.reply('Your sticker packs:\n⭐ = Favorite\n✏️ = You can edit', {
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    // Handle specific pack selection for editing
    if (action.startsWith('select_pack:')) {
        const packName = action.split(':')[1];
        
        // Verify user can edit this pack
        const canEdit = await canUserEditPack(ctx, packName);
        if (!canEdit) {
            return ctx.reply('You don\'t have permission to edit this pack.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to Pack Management', callback_data: 'select_packs' }]
                    ]
                }
            });
        }
        
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
    
    // View pack details and provide options
    if (action.startsWith('view_pack:')) {
        const packName = action.split(':')[1];
        const pack = await getStickerPackByName(packName);
        
        if (!pack) {
            return ctx.reply('This pack doesn\'t exist or has been deleted.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to My Packs', callback_data: 'my_packs' }]
                    ]
                }
            });
        }
        
        // Check if user can edit
        const canEdit = await canUserEditPack(ctx, packName);
        
        const keyboard = [];
        
        // Edit option if user can edit
        if (canEdit) {
            keyboard.push([{ text: 'Add Stickers', callback_data: `select_pack:${packName}` }]);
        }
        
        // Add other options
        keyboard.push([{ text: 'View Pack', url: `https://t.me/addstickers/${packName}` }]);
        keyboard.push([{ text: 'Toggle Favorite', callback_data: `toggle_favorite:${pack.id}` }]);
        keyboard.push([{ text: 'Remove from My Packs', callback_data: `remove_pack:${pack.id}` }]);
        keyboard.push([{ text: 'Return to My Packs', callback_data: 'my_packs' }]);
        
        return ctx.reply(`Pack: ${pack.title}\nCreated: ${new Date(pack.created_at).toLocaleDateString()}\nLast Modified: ${new Date(pack.last_modified).toLocaleDateString()}`, {
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    // Toggle favorite status
    if (action.startsWith('toggle_favorite:')) {
        const packId = parseInt(action.split(':')[1]);
        try {
            const isFavorite = await toggleFavoritePack(ctx.from.id, packId);
            return ctx.reply(`Pack ${isFavorite ? 'added to' : 'removed from'} favorites!`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to My Packs', callback_data: 'my_packs' }]
                    ]
                }
            });
        } catch (err) {
            return ctx.reply(`Error: ${err.message}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to My Packs', callback_data: 'my_packs' }]
                    ]
                }
            });
        }
    }
    
    // Remove pack from user's collection
    if (action.startsWith('remove_pack:')) {
        const packId = parseInt(action.split(':')[1]);
        try {
            await removeUserPack(ctx.from.id, packId);
            return ctx.reply('Pack removed from your collection.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to My Packs', callback_data: 'my_packs' }]
                    ]
                }
            });
        } catch (err) {
            return ctx.reply(`Error: ${err.message}`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Return to My Packs', callback_data: 'my_packs' }]
                    ]
                }
            });
        }
    }
    
    // Handle completion of adding stickers
    if (action === 'finish_adding') {
        session.packCreationStep = null;
        const packName = session.currentPackName;
        session.currentPackName = null;
        
        return ctx.reply('Sticker pack updated! You can now use your stickers in any chat.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'View Pack', url: `https://t.me/addstickers/${packName}` }],
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