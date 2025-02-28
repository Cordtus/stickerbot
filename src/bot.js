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
      await ctx.reply('Please select a mode first using /start.');
      return;
  }

  const files = ctx.message.photo 
      ? [{ fileId: ctx.message.photo[ctx.message.photo.length - 1]?.file_id, fileSize: ctx.message.photo[ctx.message.photo.length - 1]?.file_size }]
      : ctx.message.document 
          ? [{ fileId: ctx.message.document.file_id, fileName: ctx.message.document.file_name }]
          : [];

  if (!files.length) {
      await ctx.reply('No valid file was found in your message. Please send an image or document.');
      return;
  }

  session.images = files;

  try {
      const results = await processImages(ctx, session.images, 
          session.mode === 'icon' 
              ? { width: 100, height: 100 } 
              : { width: 512, height: 462, addBuffer: true }
      );

      if (results.success.length > 0) {
          await ctx.reply(`${results.success.length} file(s) processed successfully!`);
      }

      if (results.failures.length > 0) {
          await ctx.reply(`${results.failures.length} file(s) failed to process. Please try again.`);
      }

      if (results.skipped.length > 0) {
          await ctx.reply(`${results.skipped.length} thumbnail(s) were skipped.`);
      }
  } catch (err) {
      console.error('Error during image processing:', err.message);
      await ctx.reply('An unexpected error occurred while processing your files.');
  }
});

bot.on('sticker', async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = null;

  try {
      const result = await processStickerMessage(ctx);

      if (result.success) {
          await ctx.replyWithDocument({ source: result.filePath, filename: result.filename });

          // Cleanup temporary file
          if (fs.existsSync(result.filePath)) {
              fs.unlinkSync(result.filePath);
          }

          await ctx.reply('Sticker processed successfully! What would you like to do next?', {
              reply_markup: {
                  inline_keyboard: [
                      [{ text: 'Return to Main Menu', callback_data: 'start_over' }]
                  ],
              },
          });
      } else {
          throw new Error(result.error || 'Sticker processing failed due to unknown reasons.');
      }
  } catch (err) {
      console.error('Error processing sticker:', err.message);
      await ctx.reply('An error occurred while processing your sticker. Please try again.');
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
