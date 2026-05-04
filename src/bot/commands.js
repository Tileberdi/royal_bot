const { Markup } = require('telegraf');
const T = require('../locales/ru');
const txnService = require('../services/transaction');
const { formatDate } = require('../utils/helpers');

module.exports = (bot) => {

  // History button
  bot.hears(T.btn.history, async (ctx) => {
    const transactions = await txnService.getUserTransactions(ctx.from.id, 5);

    if (transactions.length === 0) {
      return ctx.reply('📜 У вас ещё нет транзакций.');
    }

    const statusEmoji = {
      pending: '⏳',
      processing: '🔄',
      completed: '✅',
      rejected: '❌',
      expired: '⏰',
    };

    const lines = transactions.map((t) =>
      `${statusEmoji[t.status] || '❓'} ${t.type === 'deposit' ? 'Пополнение' : 'Вывод'} ` +
      `${t.amount} сом | ${t.bookmaker?.toUpperCase()} | ${formatDate(t.created_at)}`
    );

    await ctx.reply(`📜 *Последние транзакции:*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
    });
  });

};