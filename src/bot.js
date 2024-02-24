require('dotenv').config();
const fs = require('fs');
const { Telegraf } = require('telegraf');
const { processImageContent, processStickerMessage } = require('./imageProcessor');
const { getSession } = require('./sessionManager');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = 'start';
  ctx.reply('Welcome! Please send me an image or a static sticker.');
});

bot.on('photo', processImageContent);
bot.on('document', processImageContent);

bot.on('sticker', async (ctx) => {
  const result = await processStickerMessage(ctx);
  if (result && result.filePath && result.filename) {
    await ctx.replyWithDocument({ source: result.filePath, filename: result.filename })
      .then(() => {
        // delete file after send
        fs.unlinkSync(result.filePath);
      })
      .catch(err => {
        console.error(err);
        ctx.reply('There was an error sending your sticker.');
        // delete file even if send fails
        if (fs.existsSync(result.filePath)) {
          fs.unlinkSync(result.filePath);
        }
      });
  }
});

bot.launch();
console.log('Bot is running');
