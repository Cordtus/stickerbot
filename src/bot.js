require('dotenv').config();
const fs = require('fs');
const { Telegraf } = require('telegraf');
const { processImageContent, processStickerMessage } = require('./imageProcessor');
const { getSession } = require('./sessionManager');
const { handleMessage } = require('./messageHandlers');


const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = 'start';
  ctx.reply('Welcome! Please send me an image or a static sticker.');
});

bot.on('photo', processImageContent);
bot.on('document', processImageContent);
bot.on('sticker', async (ctx) => {
  const filePath = await processStickerMessage(ctx);
  if (filePath) {
    await ctx.replyWithDocument({ source: filePath });
    fs.unlinkSync(filePath); // wipe file after send
  }
});

bot.launch();
console.log('Bot is running');
