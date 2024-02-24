require('dotenv').config();
const { Telegraf } = require('telegraf');
const { processImageContent } = require('./imageProcessor');
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
bot.on('sticker', ctx => {
  if (ctx.message.sticker.is_animated) {
    ctx.reply('Currently, animated stickers are not supported. Please send a static image or sticker.');
  } else {
    processImageMessage(ctx);
  }
}); // Ensure there's only one closing brace and one closing parenthesis here.

bot.launch();
console.log('Bot is running');
