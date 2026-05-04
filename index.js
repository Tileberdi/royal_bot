require('dotenv').config();
const bot = require('./src/bot');

require('./src/bot/commands')(bot);
require('./src/bot/admin')(bot);

bot.catch((err, ctx) => {
  console.error(`❌ Bot error for ${ctx.updateType}:`, err);
  ctx.reply('❌ Произошла ошибка. Попробуйте ещё раз.').catch(() => {});
});

// Start admin panel API
const { startApi } = require('./src/api');
startApi(process.env.API_PORT || 3001);

bot.launch()
  .then(() => console.log('🚀 Bot is running!'))
  .catch((err) => {
    console.error('❌ Failed to launch bot:', err);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));