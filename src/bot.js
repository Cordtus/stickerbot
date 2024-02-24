require('dotenv').config();
const { Telegraf } = require('telegraf');
const processImageMessage = require('./imageProcessor');
const { getSession } = require('./sessionManager');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = 'start';
  ctx.reply('Please send me an image or a static sticker.');
});

bot.on('photo', processImageMessage);
bot.on('sticker', ctx => {
  if (ctx.message.sticker.is_animated) {
    ctx.reply('Currently, animated stickers are not supported. Please send a static image or sticker.');
  } else {
    processImageMessage(ctx); // Handle static stickers similarly to photos
  }
});

bot.launch();
console.log('Bot is running');
