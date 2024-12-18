// bot.js

import fs from 'fs';
import path from 'path';
import { Telegraf } from 'telegraf';
import { processImages, processStickerMessage } from './imageProcessor.js';
import { getSession } from './sessionManager.js';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = null;
  session.mode = null; // Add mode tracking
  ctx.reply('Welcome! Please select a mode for image conversion:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Icon Format (100x100)', callback_data: 'select_icon' }],
        [{ text: 'Sticker Format (512x512 with buffer)', callback_data: 'select_sticker' }]
      ]
    }
  });
});

bot.on('callback_query', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const action = ctx.callbackQuery.data;

  if (action === 'select_icon') {
    session.mode = 'icon';
    ctx.reply('You have selected Icon Format. Please send one or more images to convert.');
  } else if (action === 'select_sticker') {
    session.mode = 'sticker';
    ctx.reply('You have selected Sticker Format. Please send one or more images to convert.');
  } else if (action === 'start_over') {
    session.mode = null;
    session.lastAction = null;
    ctx.reply('Please select a mode for image conversion:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Icon Format (100x100)', callback_data: 'select_icon' }],
          [{ text: 'Sticker Format (512x512 with buffer)', callback_data: 'select_sticker' }]
        ]
      }
    });  
  } else if (action === 'convert_more') {
    if (session.mode === 'icon') {
      ctx.reply('You are still in Icon Format mode. Please send more images to convert.');
    } else if (session.mode === 'sticker') {
      ctx.reply('You are still in Sticker Format mode. Please send more images to convert.');
    }
  } else {
    ctx.reply('Invalid selection.');
  }
});

bot.on(['photo', 'document'], async (ctx) => {
  const session = getSession(ctx.chat.id);

  if (!session.mode) {
    ctx.reply('Please select a mode first using /start.');
    return;
  }

  // Gather all images or documents from the message
  const files = ctx.message.photo || [ctx.message.document];
  session.images = files.map(file => ({ fileId: file.file_id, fileName: file.file_name }));

  if (session.mode === 'icon') {
    await processImages(ctx, session.images, { width: 100, height: 100 });
  } else if (session.mode === 'sticker') {
    await processImages(ctx, session.images, { width: 512, height: 462, addBuffer: true });
  }

  ctx.reply('Conversion completed! What would you like to do next?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Start Over', callback_data: 'start_over' }],
        [{ text: 'Convert More', callback_data: 'convert_more' }]
      ]
    }
  });
});

bot.on('sticker', async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = null;

  try {
    const result = await processStickerMessage(ctx);

    if (result && result.filePath && result.filename) {
      await ctx.replyWithDocument({ source: result.filePath, filename: result.filename });

      // Delete the temporary file after sending
      fs.unlinkSync(result.filePath);
    } else {
      ctx.reply('There was an error processing your sticker.');
    }
  } catch (err) {
    console.error('Error processing sticker:', err);
    ctx.reply('An error occurred while processing your sticker.');
  }
});

bot.on('message', (ctx) => {
  const message = ctx.message;
  if (message.text && !message.photo && !message.document && !message.sticker) {
    ctx.reply('Please send a valid image or sticker.');
  }
});

bot.launch();
console.log('Bot is running');
