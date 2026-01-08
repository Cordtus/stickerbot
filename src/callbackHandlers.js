// callbackHandlers.js

import { getSession } from './sessionManager.js';
import { 
    getUserStickerPacks, 
    getStickerPackByName, 
    canUserEditPack,
    toggleFavoritePack,
    removeUserPack,
    addExternalPack
} from './databaseManager.js';

// Enhanced logger
function logWithContext(context, message, error = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${context}] ${message}`);
    if (error) {
        console.error(`[${timestamp}] [${context}] ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

/**
 * Safely edit message keyboard or create new message if edit fails
 */
async function safeEditOrReply(ctx, text, keyboard, forceNew = false) {
    if (forceNew || !ctx.callbackQuery) {
        return ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
    }
    
    try {
        // Try to edit existing message
        if (ctx.callbackQuery.message.text !== text) {
            // Text is different, edit both text and markup
            await ctx.editMessageText(text, { reply_markup: { inline_keyboard: keyboard } });
        } else {
            // Text is same, just edit markup
            await ctx.editMessageReplyMarkup({ inline_keyboard: keyboard });
        }
        return true;
    } catch (err) {
        // If edit fails (message too old, etc.), send new message
        logWithContext('safeEditOrReply', 'Edit failed, sending new message', err);
        return ctx.reply(text, { reply_markup: { inline_keyboard: keyboard } });
    }
}

/**
 * Add restart button to any keyboard
 */
function addRestartButton(keyboard, includeBack = null) {
    const newKeyboard = [...keyboard];
    
    const bottomRow = [];
    if (includeBack) {
        bottomRow.push({ text: '⬅️ Back', callback_data: includeBack });
    }
    bottomRow.push({ text: '🏠 Main Menu', callback_data: 'start_over' });
    
    newKeyboard.push(bottomRow);
    return newKeyboard;
}

// Handle mode selection (Icon, Sticker, Packs)
async function handleModeSelection(ctx) {
    const action = ctx.callbackQuery.data;
    const session = getSession(ctx.chat.id);
    
    if (action === 'start_over') {
        // Reset session and show main menu
        Object.assign(session, {
            lastAction: null,
            mode: null,
            currentPackName: null,
            packCreationStep: null
        });

        const keyboard = [
            [{ text: 'Icon Format (100x100)', callback_data: 'select_icon' }],
            [{ text: 'Sticker Format (512x512)', callback_data: 'select_sticker' }],
            [{ text: 'Manage Sticker Packs', callback_data: 'select_packs' }]
        ];

        await safeEditOrReply(ctx, 'Please select a mode:', keyboard);
        await ctx.answerCbQuery();
        return true;
    }
    
    if (action === 'select_icon') {
        session.mode = 'icon';
        session.lastAction = action;

        const keyboard = [
            [{ text: 'Convert More Images', callback_data: 'convert_more' }],
            [{ text: '🏠 Main Menu', callback_data: 'start_over' }]
        ];

        await safeEditOrReply(ctx, 'Icon Format selected (100x100px). Send images to convert!', keyboard);
        await ctx.answerCbQuery('Icon format selected');
        return true;
    }
    
    if (action === 'select_sticker') {
        session.mode = 'sticker';
        session.lastAction = action;

        const keyboard = [
            [{ text: 'Convert More Media', callback_data: 'convert_more' }],
            [{ text: '🏠 Main Menu', callback_data: 'start_over' }]
        ];

        await safeEditOrReply(ctx, 'Sticker Format selected (512x512px). Send images, videos, or GIFs to convert!', keyboard);
        await ctx.answerCbQuery('Sticker format selected');
        return true;
    }
    
    if (action === 'select_packs') {
        session.mode = 'packs';
        session.lastAction = action;

        const keyboard = [
            [{ text: 'Create New Pack', callback_data: 'create_pack' }],
            [{ text: 'Add to Existing Pack', callback_data: 'list_packs' }],
            [{ text: 'Add External Pack', callback_data: 'add_external_pack' }],
            [{ text: 'My Packs', callback_data: 'my_packs' }],
            [{ text: '🏠 Main Menu', callback_data: 'start_over' }]
        ];

        await safeEditOrReply(ctx, 'Sticker Pack Management', keyboard);
        await ctx.answerCbQuery('Pack management selected');
        return true;
    }
    
    return false; // Not handled
}

// Handle post-processing callbacks (continue, convert more, etc.)
async function handlePostProcessCallbacks(ctx) {
    const action = ctx.callbackQuery.data;
    const session = getSession(ctx.chat.id);
    
    if (action === 'convert_more') {
        // Keep current mode but allow more conversions
        const modeText = session.mode === 'icon' ? 
            'Icon Format (100x100px). Send more images!' :
            'Sticker Format (512x512px). Send more media!';

        const keyboard = addRestartButton([[{ text: 'Change Mode', callback_data: 'start_over' }]]);

        await safeEditOrReply(ctx, modeText, keyboard);
        await ctx.answerCbQuery('Ready for more files');
        return true;
    }
    
    return false; // Not handled
}

// Handle pack creation and management
async function handlePackCallbacks(ctx) {
    const action = ctx.callbackQuery.data;
    const session = getSession(ctx.chat.id);
    
    if (action === 'create_pack') {
        session.packCreationStep = 'waiting_title';

        const keyboard = addRestartButton([], 'select_packs');
        
        await safeEditOrReply(ctx, 'Send me the title for your new sticker pack (1-64 characters):', keyboard, true);
        await ctx.answerCbQuery();
        return true;
    }
    
    if (action === 'add_external_pack') {
        session.packCreationStep = 'waiting_external_pack';

        const keyboard = addRestartButton([], 'select_packs');

        await safeEditOrReply(ctx, 'Send me a sticker from the pack you want to add, or send a pack link (t.me/addstickers/packname):', keyboard, true);
        await ctx.answerCbQuery();
        return true;
    }

    // List user's existing packs for adding stickers
    if (action === 'list_packs') {
        const userPacks = await getUserStickerPacks(ctx);
        const editablePacks = userPacks.filter(pack => pack.can_edit);
        
        if (editablePacks.length === 0) {
            const keyboard = [
                [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                [{ text: '⬅️ Back', callback_data: 'select_packs' }, { text: '🏠 Main Menu', callback_data: 'start_over' }]
            ];

            await safeEditOrReply(ctx, 'You don\'t have any editable sticker packs yet. Create one first.', keyboard);
            await ctx.answerCbQuery();
            return true;
        }
        
        const keyboard = editablePacks.map(pack => (
            [{ text: pack.title, callback_data: `select_pack:${pack.name}` }]
        ));
        
        keyboard.push([{ text: '⬅️ Back', callback_data: 'select_packs' }, { text: '🏠 Main Menu', callback_data: 'start_over' }]);
        
        await safeEditOrReply(ctx, 'Select a sticker pack to add stickers to:', keyboard);
        await ctx.answerCbQuery();
        return true;
    }
    
    // View user's packs
    if (action === 'my_packs') {
        const userPacks = await getUserStickerPacks(ctx);
        
        if (userPacks.length === 0) {
            const keyboard = [
                [{ text: 'Create New Pack', callback_data: 'create_pack' }],
                [{ text: 'Add External Pack', callback_data: 'add_external_pack' }],
                [{ text: '⬅️ Back', callback_data: 'select_packs' }, { text: '🏠 Main Menu', callback_data: 'start_over' }]
            ];

            await safeEditOrReply(ctx, 'You don\'t have any sticker packs yet. Create one or add an external pack.', keyboard);
            await ctx.answerCbQuery();
            return true;
        }
        
        const keyboard = userPacks.map(pack => {
            const starSymbol = pack.is_favorite ? '⭐ ' : '';
            const editSymbol = pack.can_edit ? '✏️ ' : '';
            return [{ 
                text: `${starSymbol}${editSymbol}${pack.title}`, 
                callback_data: `view_pack:${pack.name}` 
            }];
        });
        
        keyboard.push([{ text: '⬅️ Back', callback_data: 'select_packs' }, { text: '🏠 Main Menu', callback_data: 'start_over' }]);
        
        await safeEditOrReply(ctx, 'Your sticker packs:\n⭐ = Favorite\n✏️ = You can edit', keyboard);
        await ctx.answerCbQuery();
        return true;
    }
    
    // Handle specific pack selection for editing
    if (action.startsWith('select_pack:')) {
        const packName = action.split(':')[1];
        
        const canEdit = await canUserEditPack(ctx, packName);
        if (!canEdit) {
            const keyboard = addRestartButton([], 'list_packs');

            await safeEditOrReply(ctx, 'You don\'t have permission to edit this pack.', keyboard, true);
            await ctx.answerCbQuery('Cannot edit this pack');
            return true;
        }
        
        session.currentPackName = packName;
        session.packCreationStep = 'adding_stickers';
        
        const keyboard = [
            [{ text: 'Finish Adding Stickers', callback_data: 'finish_adding' }],
            [{ text: '⬅️ Back', callback_data: 'list_packs' }, { text: '🏠 Main Menu', callback_data: 'start_over' }]
        ];

        await safeEditOrReply(ctx, `Selected pack "${packName}". Send stickers, images, or videos to add to this pack.`, keyboard, true);
        await ctx.answerCbQuery(`Selected ${packName}`);
        return true;
    }
    
    // View pack details and provide options
    if (action.startsWith('view_pack:')) {
        const packName = action.split(':')[1];
        const pack = await getStickerPackByName(packName);
        
        if (!pack) {
            const keyboard = addRestartButton([], 'my_packs');

            await safeEditOrReply(ctx, 'This pack doesn\'t exist or has been deleted.', keyboard);
            await ctx.answerCbQuery('Pack not found');
            return true;
        }
        
        const canEdit = await canUserEditPack(ctx, packName);
        const keyboard = [];
        
        if (canEdit) {
            keyboard.push([{ text: '✏️ Add Stickers', callback_data: `select_pack:${packName}` }]);
        }
        
        keyboard.push([{ text: '📱 View Pack', url: `https://t.me/addstickers/${packName}` }]);
        keyboard.push([
            { text: pack.is_favorite ? '🌚 Unfavorite' : '⭐ Favorite', callback_data: `toggle_favorite:${pack.id}` },
            { text: '🗑️ Remove', callback_data: `remove_pack:${pack.id}` }
        ]);
        keyboard.push([{ text: '⬅️ Back', callback_data: 'my_packs' }, { text: '🏠 Main Menu', callback_data: 'start_over' }]);
        
        const text = `Pack: ${pack.title}\nCreated: ${new Date(pack.created_at).toLocaleDateString()}\nLast Modified: ${new Date(pack.last_modified).toLocaleDateString()}`;
        
        await safeEditOrReply(ctx, text, keyboard);
        await ctx.answerCbQuery();
        return true;
    }
    
    // Toggle favorite status
    if (action.startsWith('toggle_favorite:')) {
        const packId = parseInt(action.split(':')[1]);
        try {
            const isFavorite = await toggleFavoritePack(ctx.from.id, packId);
            
            const keyboard = addRestartButton([], 'my_packs');
            
            await safeEditOrReply(ctx, `Pack ${isFavorite ? 'added to' : 'removed from'} favorites!`, keyboard, true);
            await ctx.answerCbQuery(`${isFavorite ? 'Added to' : 'Removed from'} favorites`);
            return true;
        } catch (err) {
            const keyboard = addRestartButton([], 'my_packs');
            
            await safeEditOrReply(ctx, `Error: ${err.message}`, keyboard, true);
            await ctx.answerCbQuery('Error occurred');
            return true;
        }
    }
    
    // Remove pack from user's collection
    if (action.startsWith('remove_pack:')) {
        const packId = parseInt(action.split(':')[1]);
        try {
            await removeUserPack(ctx.from.id, packId);
            
            const keyboard = addRestartButton([], 'my_packs');
            
            await safeEditOrReply(ctx, 'Pack removed from your collection.', keyboard, true);
            await ctx.answerCbQuery('Pack removed');
            return true;
        } catch (err) {
            const keyboard = addRestartButton([], 'my_packs');
            
            await safeEditOrReply(ctx, `Error: ${err.message}`, keyboard, true);
            await ctx.answerCbQuery('Error occurred');
            return true;
        }
    }
    
    // Handle completion of adding stickers
    if (action === 'finish_adding') {
        session.packCreationStep = null;
        const packName = session.currentPackName;
        session.currentPackName = null;
        
        const keyboard = [
            [{ text: '📱 View Pack', url: `https://t.me/addstickers/${packName}` }],
            [{ text: 'Add More Packs', callback_data: 'select_packs' }],
            [{ text: '🏠 Main Menu', callback_data: 'start_over' }]
        ];

        await safeEditOrReply(ctx, 'Sticker pack updated! You can now use your stickers in any chat.', keyboard, true);
        await ctx.answerCbQuery('Pack completed');
        return true;
    }
    
    return false; // Not handled
}

// Main callback handler
async function handleCallback(ctx) {
    try {
        // Answer callback query first to remove loading state
        if (!ctx.callbackQuery.data.startsWith('http')) {
            await ctx.answerCbQuery();
        }
        
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
        await ctx.answerCbQuery('Invalid selection');
        logWithContext('handleCallback', `Unhandled callback: ${ctx.callbackQuery.data}`);
    } catch (error) {
        logWithContext('handleCallback', 'Error handling callback', error);
        await ctx.answerCbQuery('An error occurred');
        
        // Fallback - offer restart
        const keyboard = [[{ text: '🏠 Main Menu', callback_data: 'start_over' }]];
        await ctx.reply(`Error: ${error.message}`, { reply_markup: { inline_keyboard: keyboard } });
    }
}

export { 
    handleCallback,
    handleModeSelection,
    handlePostProcessCallbacks,
    handlePackCallbacks,
    safeEditOrReply,
    addRestartButton
};