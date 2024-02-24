require('dotenv').config();
const { Telegraf } = require('telegraf');
const processImageMessage = require('./imageProcessor');
const { getSession } = require('./sessionManager');
const { handleMessage } = require('./messageHandlers');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  const session = getSession(ctx.chat.id);
  session.lastAction = 'start';
  ctx.reply(
    'Welcome! Please send me an image or a static sticker.',
    {
      reply_markup: {
        keyboard: [[{ text: 'Start' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
});

bot.on('photo', processImageMessage);
bot.on('sticker', ctx => {
    if (ctx.message.sticker.is_animated) {
        ctx.reply('Currently, animated stickers are not supported. Please send a static image or sticker.');
    } else {
        processImageMessage(ctx);
    }
});

bot.launch();
console.log('Bot is running');
