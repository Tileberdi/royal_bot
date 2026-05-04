const { Telegraf, Scenes, session, Markup } = require('telegraf');
require('dotenv').config();
const T = require('../locales/ru');
const txnService = require('../services/transaction');
const sessionService = require('../services/session');
const { getUserName, formatAmount, formatDate } = require('../utils/helpers');
const { depositScene, withdrawalScene } = require('./scenes');
const db = require('../db');
const bot = new Telegraf(process.env.BOT_TOKEN);
const cancelKeyboard = Markup.keyboard([[T.btn.cancel]]).resize();

const checkSubscription = async (ctx) => {
  try {
    const member = await ctx.telegram.getChatMember(process.env.REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('Subscription check error:', err.message);
    return false;
  }
};

const stage = new Scenes.Stage([depositScene, withdrawalScene]);
bot.use(session());
bot.use(stage.middleware());

bot.use(async (ctx, next) => {
  if (ctx.from) {
    try {
      await txnService.upsertUser(ctx.from);
      const blocked = await txnService.isUserBlocked(ctx.from.id);
      if (blocked) return ctx.reply(T.userBlocked);
    } catch (err) { console.error('Middleware error:', err); }
  }
  return next();
});

bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.text === '/start') return next();
  if (ctx.callbackQuery) return next();
  if (ctx.from) {
    const isSubscribed = await checkSubscription(ctx);
    if (!isSubscribed) {
      await ctx.reply(
        '⛔ Для использования бота необходимо подписаться на наш канал!\n\n📢 Подпишитесь и нажмите кнопку ниже:',
        Markup.inlineKeyboard([
          [Markup.button.url('📢 Подписаться на канал', 'https://t.me/' + process.env.REQUIRED_CHANNEL.replace('@', ''))],
          [Markup.button.callback('✅ Я подписался', 'check_subscription')],
        ])
      );
      return;
    }
  }
  return next();
});

bot.start(async (ctx) => {
  const name = getUserName(ctx).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  const isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    await ctx.reply(
      '👋 Привет, ' + name + '!\n\n⛔ Для использования бота необходимо подписаться на наш канал!\n\n📢 Подпишитесь и нажмите кнопку ниже:',
      Markup.inlineKeyboard([
        [Markup.button.url('📢 Подписаться на канал', 'https://t.me/' + process.env.REQUIRED_CHANNEL.replace('@', ''))],
        [Markup.button.callback('✅ Я подписался', 'check_subscription')],
      ])
    );
    return;
  }
  await ctx.reply(T.welcome(name), {
    parse_mode: 'Markdown',
    ...Markup.keyboard([
      [T.btn.deposit, T.btn.withdraw],
      [T.btn.history, T.btn.support],
    ]).resize(),
  });
});

bot.command('cancel', async (ctx) => {
  await sessionService.clearSession(ctx.from.id);
  await ctx.scene.leave();
  await ctx.reply('❌ Отменено', Markup.keyboard([
    [T.btn.deposit, T.btn.withdraw],
          [T.btn.support],
  ]).resize());
});

bot.hears(T.btn.deposit, async (ctx) => {
  const { checkRateLimit } = require('../services/rateLimit');
  const check = await checkRateLimit(ctx.from.id, 'deposit');
  if (!check.allowed) return ctx.reply(check.message);
  return ctx.scene.enter('deposit');
});

bot.hears(T.btn.withdraw, async (ctx) => {
  const { checkRateLimit } = require('../services/rateLimit');
  const check = await checkRateLimit(ctx.from.id, 'withdrawal');
  if (!check.allowed) return ctx.reply(check.message);
  return ctx.scene.enter('withdrawal');
});

bot.hears(T.btn.support, (ctx) => ctx.reply('👤 Поддержка: @maximusbos \nРаботаем 24/7! 🔥'));

bot.hears(T.btn.cancel, async (ctx) => {
  await sessionService.clearSession(ctx.from.id);
  await ctx.scene.leave();
  await ctx.reply('❌ Отменено', Markup.keyboard([
    [T.btn.deposit, T.btn.withdraw],
    [T.btn.history, T.btn.support],
  ]).resize());
});

bot.hears(T.btn.history, async (ctx) => {
  const transactions = await txnService.getUserTransactions(ctx.from.id, 5);
  if (transactions.length === 0) return ctx.reply('📜 У вас ещё нет транзакций.');
  const statusEmoji = { pending: '⏳', processing: '🔄', completed: '✅', rejected: '❌', expired: '⏰' };
  const typeLabel = { deposit: 'Пополнение', withdrawal: 'Вывод' };
  const lines = transactions.map((t) =>
    (statusEmoji[t.status] || '❓') + ' ' + typeLabel[t.type] + ' ' + t.amount + ' сом | ' +
    (t.bookmaker ? t.bookmaker.toUpperCase() : '') + ' | ' + formatDate(t.created_at)
  );
  await ctx.reply('📜 Последние транзакции:\n\n' + lines.join('\n'));
});

// ─── Payment method buttons (legacy fallback) ─────────────────────────────
const paymentLinks = {
  pay_mbank: { name: 'MBANK', getLink: () => 'https://app.mbank.kg/qr/#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6' },
  'pay_odeньги': { name: 'O!Деньги', getLink: () => 'https://api.dengi.o.kg/#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6' },
  pay_kompanion: { name: 'kompanion', getLink: () => 'https://24.kompanion.kg/qr/#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6' },
  pay_bakai: { name: 'BAKAI BANK', getLink: () => 'https://bakai.app#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6' },
};

Object.entries(paymentLinks).forEach(function(entry) {
  var action = entry[0];
  var name = entry[1].name;
  var getLink = entry[1].getLink;

  bot.action(action, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    const session = await sessionService.getSession(ctx.from.id);
    const link = getLink(session.amount, session.accountId);

    await sessionService.updateSession(ctx.from.id, {
      paymentMethod: name,
      awaitingReceipt: true,
      bookmaker: session.bookmaker,
      accountId: session.accountId,
      amount: session.amount,
      finalAmount: session.finalAmount,
      formattedTotal: session.formattedTotal,
    });

    const displayAmount = session.finalAmount
      ? session.finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : formatAmount(session.amount);

    await ctx.reply(
      '✅ Вы выбрали: ' + name + '\n' +
      '✅ Сумма к оплате: *' + displayAmount + '*\n' +
      '⚠️ Обязательно переведите точную сумму (с копейками)\n' +
      '✅ Отправьте чек об оплате в этот чат',
      {
        ...Markup.inlineKeyboard([
          [Markup.button.url('💳 ОТКРЫТЬ ' + name, link)]
        ])
      }
    );
  });
});

// ─── Receipt handler ──────────────────────────────────────────────────────
bot.on('photo', async (ctx) => {
  const session = await sessionService.getSession(ctx.from.id);
  if (!session.awaitingReceipt) return;

  const photo = ctx.message.photo;
  const fileId = photo[photo.length - 1].file_id;

  try {
    const txn = await txnService.createDeposit({
      telegramId: ctx.from.id,
      bookmaker: session.bookmaker,
      accountId: session.accountId,
      amount: session.amount,
      finalAmount: session.finalAmount,
      paymentMethod: session.paymentMethod,
    });

    await txnService.attachReceipt(txn.id, fileId);

    const adminCaption =
      '🆕 НОВОЕ ПОПОЛНЕНИЕ\n\n' +
      '👤 Пользователь: ' + (ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name) + '\n' +
      '💰 Сумма: ' + formatAmount(session.finalAmount) + ' сом\n' +
      '🏦 Букмекер: ' + session.bookmaker + '\n' +
      '🆔 Аккаунт: ' + session.accountId + '\n' +
      '💳 Способ: ' + (session.paymentMethod ? session.paymentMethod.toUpperCase() : '') + '\n' +
      '📋 ID: ' + txn.id;

    const adminMsg = await ctx.telegram.sendPhoto(
      process.env.ADMIN_CHAT_ID,
      fileId,
      {
        caption: adminCaption,
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Подтвердить', 'approve_' + txn.id),
            Markup.button.callback('❌ Отклонить', 'reject_' + txn.id),
          ],
        ]),
      }
    );

    if (adminMsg) {
      await db.query('UPDATE transactions SET admin_note = $1 WHERE id = $2', [String(adminMsg.message_id), txn.id]);
    }

    await ctx.reply(
      '✅ Ваша заявка принята!\n\n' +
      '🏦 Букмекер: ' + session.bookmaker + '\n' +
      '🆔 ID: ' + session.accountId + '\n' +
      '💰 Сумма: ' + formatAmount(session.finalAmount) + ' сом\n\n' +
      '⏳ Ожидайте подтверждения. Обычно 10 сек – 1 мин.\n' +
      'Если возникли проблемы: @maximusbos',
      Markup.keyboard([
        [T.btn.deposit, T.btn.withdraw],
        [T.btn.history, T.btn.support],
      ]).resize()
    );

    await sessionService.clearSession(ctx.from.id);
  } catch (err) {
    console.error('Receipt handler error:', err);
    await ctx.reply(T.errorGeneral);
  }
});

// ─── Check subscription button ────────────────────────────────────────────
bot.action('check_subscription', async (ctx) => {
  await ctx.answerCbQuery();
  const isSubscribed = await checkSubscription(ctx);
  if (isSubscribed) {
    await ctx.editMessageText('✅ Спасибо за подписку! Теперь вы можете пользоваться ботом.');
    const name = getUserName(ctx).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    await ctx.reply(T.welcome(name), {
      parse_mode: 'Markdown',
      ...Markup.keyboard([
        [T.btn.deposit, T.btn.withdraw],
        [T.btn.history, T.btn.support],
      ]).resize(),
    });
  } else {
    await ctx.answerCbQuery('❌ Вы ещё не подписались!', { show_alert: true });
  }
});

// ─── Admin: approve ───────────────────────────────────────────────────────
bot.action(/^approve_(.+)$/, async (ctx) => {
  const txnId = ctx.match[1];
  try {
    const txn = await txnService.getTransaction(txnId);
    if (!txn) return ctx.answerCbQuery('❌ Транзакция не найдена');
    if (txn.status === 'completed') return ctx.answerCbQuery('Уже подтверждено ✅');
    if (txn.status === 'expired') return ctx.answerCbQuery('⏰ Заявка истекла');

    await ctx.answerCbQuery('⏳ Обрабатываем...');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    const xbetApi = require('../services/xbetApi');

    // Check cashdesk balance
    const balanceData = await xbetApi.getCashdeskBalance();
    if (balanceData && (balanceData.success || balanceData.Success)) {
      const balance = parseFloat(balanceData.balance || balanceData.Balance || 0);
      const needed = parseFloat(txn.final_amount || txn.amount);
      if (balance < needed) {
        return ctx.reply(
          '❌ *Недостаточно средств на кассе!*\n\n' +
          '💰 Баланс: *' + balance.toFixed(2) + '*\n' +
          '💸 Нужно: *' + needed.toFixed(2) + '*\n\n' +
          'Пополните кассу и попробуйте снова.',
          { parse_mode: 'Markdown' }
        );
      }
    }

    if (txn.type === 'deposit') {
      const result = await xbetApi.depositToPlayer(txn.bookmaker_account_id, txn.amount);
      console.log('DEPOSIT API RESULT:', JSON.stringify(result));

      if (!result.success) {
        await ctx.reply(
          '❌ Ошибка API при пополнении!\n' +
          'Аккаунт: ' + txn.bookmaker_account_id + '\n' +
          'Сумма: ' + txn.amount + ' сом\n' +
          'Ошибка: ' + result.error + '\n\n' +
          'Подтвердите вручную или отклоните:',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('🔄 Попробовать снова', 'approve_' + txn.id),
              Markup.button.callback('✅ Вручную', 'force_' + txn.id),
            ],
            [Markup.button.callback('❌ Отклонить', 'reject_' + txn.id)],
          ])
        );
        return;
      }

      await txnService.approveTransaction(txnId, ctx.from.id);

      const originalTxn = await db.getOne('SELECT admin_note FROM transactions WHERE id = $1', [txnId]);
      if (originalTxn && originalTxn.admin_note) {
        var updatedCaption =
          '✅ ПОПОЛНЕНИЕ ПОДТВЕРЖДЕНО\n\n' +
          '👤 ' + (ctx.from.username ? '@' + ctx.from.first_name : 'Админ') + '\n' +
          '💰 Сумма: ' + (result.summa || txn.amount) + ' сом\n' +
          '🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + '\n' +
          '🆔 ID: ' + txn.bookmaker_account_id + '\n\n' +
          '✅ Подтверждено через API\n' +
          '📋 ID: ' + txnId.substring(0, 8) + '...';

        await ctx.telegram.editMessageCaption(
          process.env.ADMIN_CHAT_ID,
          parseInt(originalTxn.admin_note),
          null,
          updatedCaption,
          { reply_markup: { inline_keyboard: [] } }
        ).catch(function() {});
      }

      await ctx.telegram.sendMessage(
        txn.user_id,
        '✅ Ваш счёт пополнен!\n💰 Сумма: ' + (result.summa || txn.amount) + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + ' ID: ' + txn.bookmaker_account_id
      ).catch(function() {});

    } else if (txn.type === 'withdrawal') {
      const result = await xbetApi.payoutFromPlayer(txn.bookmaker_account_id, txn.withdrawal_code);

      if (!result.success) {
        await ctx.reply(
          '❌ Ошибка API при выплате!\nОшибка: ' + result.error + '\n\nПодтвердите вручную или отклоните:',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('🔄 Попробовать снова', 'approve_' + txn.id),
                Markup.button.callback('✅ Вручную', 'force_' + txn.id),
              ],
              [Markup.button.callback('❌ Отклонить', 'reject_' + txn.id)],
            ]),
          }
        );
        return;
      }

      await txnService.approveTransaction(txnId, ctx.from.id);

      await ctx.telegram.sendMessage(
        txn.user_id,
        '✅ Выплата выполнена!\n\n💰 Сумма: *' + result.summa + ' сом*\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + ' ID: ' + txn.bookmaker_account_id,
        { parse_mode: 'Markdown' }
      ).catch(function() {});

      await ctx.reply(
        '✅ *Выплата выполнена через API*\n\n🆔 ID: ' + txn.bookmaker_account_id + '\n💰 Сумма: ' + result.summa + ' сом',
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('Approve error:', err);
    await ctx.reply('❌ Произошла ошибка. Попробуйте снова.');
  }
});

// ─── Force approve ────────────────────────────────────────────────────────
bot.action(/^force_(.+)$/, async (ctx) => {
  const txnId = ctx.match[1];
  try {
    const txn = await txnService.getTransaction(txnId);
    if (!txn) return ctx.answerCbQuery('❌ Не найдена');
    await txnService.approveTransaction(txnId, ctx.from.id);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.answerCbQuery('✅ Подтверждено вручную');
    await ctx.telegram.sendMessage(txn.user_id, '✅ Ваша заявка подтверждена!\n💰 ' + txn.amount + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '')).catch(function() {});
    await ctx.reply('✅ Подтверждено вручную\nID: ' + txnId.substring(0, 8) + '...');
  } catch (err) {
    console.error('Force approve error:', err);
  }
});

// ─── Admin: reject ────────────────────────────────────────────────────────
bot.action(/^reject_(.+)$/, async (ctx) => {
  const txnId = ctx.match[1];
  try {
    const txn = await txnService.getTransaction(txnId);
    if (!txn) return ctx.answerCbQuery('❌ Транзакция не найдена');
    if (txn.status === 'rejected') return ctx.answerCbQuery('Уже отклонено');
    if (txn.status === 'expired') return ctx.answerCbQuery('⏰ Заявка истекла');

    const savedMsgId = txn.admin_note;
    await txnService.rejectTransaction(txnId, ctx.from.id, 'Отклонено администратором');
    await ctx.answerCbQuery('❌ Отклонено');

    if (savedMsgId && process.env.ADMIN_CHAT_ID) {
      var rejectCaption =
        '❌ ПОПОЛНЕНИЕ ОТКЛОНЕНО\n\n' +
        '👤 ' + txn.user_id + '\n' +
        '💰 Сумма: ' + txn.amount + ' сом\n' +
        '🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + '\n' +
        '🆔 ID: ' + txn.bookmaker_account_id + '\n\n' +
        '❌ Отклонено админом\n' +
        '📋 ID: ' + txnId.substring(0, 8) + '...';

      await ctx.telegram.editMessageCaption(
        process.env.ADMIN_CHAT_ID,
        parseInt(savedMsgId),
        null,
        rejectCaption,
        { reply_markup: { inline_keyboard: [] } }
      ).catch(function() {});
    } else {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(function() {});
    }

    await ctx.telegram.sendMessage(
      txn.user_id,
      '❌ Ваша заявка отклонена.\nПричина: Отклонено администратором.\nПомощь: @big_boss_kg'
    ).catch(function() {});
  } catch (err) {
    console.error('Reject error:', err);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// ─── SMS handler ──────────────────────────────────────────────────────────
const smsParser = require('../services/smsParser');

bot.on('text', async (ctx, next) => {
  var isAdminUser = (process.env.ADMIN_IDS || '').split(',').map(function(id) { return parseInt(id.trim()); }).includes(ctx.from.id);
  if (!isAdminUser) return next();

  var text = ctx.message.text;
  var amount = smsParser.parseSmSAmount(text);
  if (!amount) return next();

  var senderName = smsParser.parseSenderName(text);
  var matched = await smsParser.findMatchingTransaction(amount);
  if (!matched) matched = await smsParser.findMatchingByBaseAmount(amount);

  if (matched) {
    var xbetApi = require('../services/xbetApi');
    await smsParser.saveBankNotification(text, amount, senderName, matched.id);
    await db.query('UPDATE transactions SET auto_verified = true WHERE id = $1', [matched.id]);

    var depositResult = await xbetApi.depositToPlayer(matched.bookmaker_account_id, matched.amount);

    if (depositResult.success || (depositResult.fullResponse && depositResult.fullResponse.Success)) {
      await txnService.approveTransaction(matched.id, ctx.from.id);

      var originalTxn = await db.getOne('SELECT admin_note FROM transactions WHERE id = $1', [matched.id]);
      if (originalTxn && originalTxn.admin_note && process.env.ADMIN_CHAT_ID) {
        var safeName = (matched.username || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
        var smsCaption =
          '✅ ПОПОЛНЕНИЕ ПОДТВЕРЖДЕНО\n\n' +
          '👤 ' + (matched.username ? '@' + safeName : matched.full_name) + '\n' +
          '💰 Сумма: ' + matched.amount + ' сом\n' +
          '🏦 ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '') + '\n' +
          '🆔 ID: ' + matched.bookmaker_account_id + '\n\n' +
          '⚡ Авто-пополнение через банк\n' +
          '📋 ID: ' + matched.id.substring(0, 8) + '...';

        await ctx.telegram.editMessageCaption(
          process.env.ADMIN_CHAT_ID,
          parseInt(originalTxn.admin_note),
          null,
          smsCaption,
          { reply_markup: { inline_keyboard: [] } }
        ).catch(function() {});
      }

      await ctx.telegram.sendMessage(
        matched.user_id,
        '✅ Ваш счёт пополнен автоматически!\n\n' +
        '💰 Сумма: ' + (depositResult.summa || matched.amount) + ' сом\n' +
        '🏦 ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '') + ' ID: ' + matched.bookmaker_account_id + '\n\n' +
        '⚡ Автоматическая проверка через банк'
      ).catch(function() {});

      await ctx.reply(
        '✅ Автоматически подтверждено!\n\n' +
        '👤 ' + (matched.username ? '@' + matched.username : matched.full_name) + '\n' +
        '💰 ' + amount + ' сом → ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '') + ' ID: ' + matched.bookmaker_account_id + '\n' +
        '📋 ID: ' + matched.id.substring(0, 8) + '...'
      );
    } else {
      await txnService.approveTransaction(matched.id, ctx.from.id);

      if (process.env.ADMIN_CHAT_ID) {
        await ctx.telegram.sendMessage(
          process.env.ADMIN_CHAT_ID,
          '✅ *Авто-подтверждено через банк*\n\n' +
          '👤 ' + (matched.username ? '@' + matched.username : matched.full_name) + '\n' +
          '💰 ' + amount + ' сом\n' +
          '🏦 ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '') + ' ID: ' + matched.bookmaker_account_id + '\n' +
          '📋 ID: ' + matched.id.substring(0, 8) + '...',
          { parse_mode: 'Markdown' }
        ).catch(function() {});
      }

      await ctx.telegram.sendMessage(matched.user_id, '✅ Ваш счёт пополнен!\n💰 ' + matched.amount + ' сом\n🏦 ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '')).catch(function() {});

      await ctx.reply(
        '✅ Оплата подтверждена банком!\n⚠️ API ошибка: ' + depositResult.error + '\n\n' +
        '👤 ' + (matched.username ? '@' + matched.username : matched.full_name) + '\n' +
        '💰 ' + amount + ' сом\n' +
        '📋 ID: ' + matched.id.substring(0, 8) + '...'
      );
    }
  } else {
    await smsParser.saveBankNotification(text, amount, senderName, null);
    await ctx.reply(
      '💳 Поступление обнаружено:\n\n💰 Сумма: ' + amount + ' сом\n👤 От: ' + (senderName || 'неизвестно') + '\n\n❌ Совпадений не найдено.\nНет ожидающих заявок на эту сумму.'
    );
  }
});

// ─── Auto-expire ──────────────────────────────────────────────────────────
setInterval(async function() {
  try {
    var expired = await db.getMany(
      "SELECT t.*, u.telegram_id, u.username, u.full_name FROM transactions t JOIN users u ON t.user_id = u.telegram_id WHERE t.type = 'deposit' AND t.status IN ('pending', 'processing') AND t.created_at <= NOW() - INTERVAL '10 minutes' LIMIT 10"
    );

    for (var i = 0; i < expired.length; i++) {
      var txn = expired[i];
      await db.query("UPDATE transactions SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'processing')", [txn.id]);

      if (txn.admin_note && process.env.ADMIN_CHAT_ID) {
        var expCaption =
          '⏰ ПОПОЛНЕНИЕ ИСТЕКЛО\n\n' +
          '👤 ' + (txn.username ? '@' + txn.username : txn.full_name) + '\n' +
          '💰 Сумма: ' + txn.amount + ' сом\n' +
          '🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + '\n' +
          '🆔 ID: ' + txn.bookmaker_account_id + '\n\n' +
          '⏰ Оплата не поступила (10 мин)\n' +
          '📋 ID: ' + txn.id.substring(0, 8) + '...';

        await bot.telegram.editMessageCaption(
          process.env.ADMIN_CHAT_ID,
          parseInt(txn.admin_note),
          null,
          expCaption,
          { reply_markup: { inline_keyboard: [] } }
        ).catch(function() {});
      }

      await bot.telegram.sendMessage(
        txn.user_id,
        '⏰ Ваша заявка на пополнение истекла.\n\n💰 ' + txn.amount + ' сом не было подтверждено.\nОплата не поступила в течение 10 минут.\n\nЕсли вы оплатили — обратитесь в поддержку: @maximusbos\nЕсли нет — создайте новую заявку.'
      ).catch(function() {});

      console.log('⏰ Expired transaction: ' + txn.id);
    }
  } catch (err) {
    console.error('Expiry check error:', err);
  }
}, 60000);

// ─── Wallet payment with QR generation + deep link ────────────────────────
bot.action(/^wallet_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  var walletId = ctx.match[1];
  var session = await sessionService.getSession(ctx.from.id);

  var wallet;
  try {
    wallet = await db.getOne('SELECT * FROM wallets WHERE id = $1', [walletId]);
  } catch (err) {
    console.error('Wallet fetch error:', err.message);
  }

  var walletName = wallet ? wallet.bank.toUpperCase() : 'Выбранный метод';
  var displayAmount = session.finalAmount
    ? session.finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : formatAmount(session.amount);

  await sessionService.updateSession(ctx.from.id, {
    paymentMethod: wallet ? wallet.bank : 'unknown',
    walletId: walletId,
    awaitingReceipt: true,
  });

  var bankLinks = {
    mbank: 'https://app.mbank.kg/qr/#',
    bakai: 'https://bakai.app/qr/#',
    kompanion: 'https://24.kompanion.kg/qr/#',
    optima: 'https://app.optimabank.kg/qr/#',
    demir: 'https://ebank.demirbank.kg/qr/#',
    odengi: 'https://api.dengi.o.kg/qr/#',
  };

  // Generate QR with amount + deep link
  if (wallet && wallet.qr_data && session.finalAmount) {
    try {
      var qrGen = require('../services/qrGenerator');
      var result = await qrGen.generateQR(wallet.qr_data, session.finalAmount);
      var buffer = result.buffer;
      var qrString = result.qrString;

      var bankKey = Object.keys(bankLinks).find(function(k) {
        return wallet.bank.toLowerCase().includes(k);
      });
      var baseUrl = bankKey ? bankLinks[bankKey] : null;

      var buttons = [];
      if (baseUrl) {
        var payUrl = baseUrl + qrString;
        buttons.push([Markup.button.url('💳 Оплатить ' + displayAmount + ' сом', payUrl)]);
      }

      var caption =
        '✅ *' + walletName + '*\n\n' +
        '💰 Сумма к оплате: *' + displayAmount + ' сом*\n\n' +
        '⚠️ Обязательно переведите точную сумму (с копейками)\n' +
        '✅ Отправьте чек об оплате в этот чат\n\n' +
        '⏳ Осталось: 10:00';

      await ctx.replyWithPhoto(
        { source: buffer, filename: 'payment_qr.png' },
        {
          caption: caption,
          parse_mode: 'Markdown',
          ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
        }
      );
      return;
    } catch (err) {
      console.error('QR generation error:', err.message);
    }
  }

  // Fallback: saved QR photo
  var fallbackCaption =
    '✅ *' + walletName + '*\n\n' +
    '💰 Сумма к оплате: *' + displayAmount + ' сом*\n\n' +
    '⚠️ Обязательно переведите точную сумму (с копейками)\n' +
    '✅ Отправьте чек об оплате в этот чат\n\n' +
    '⏳ Осталось: 10:00';

  if (wallet && wallet.qr_file_id) {
    var fbButtons = [];
    if (wallet.qr_link) {
      fbButtons.push([Markup.button.url('💳 Открыть ' + walletName, wallet.qr_link)]);
    }
    await ctx.replyWithPhoto(wallet.qr_file_id, {
      caption: fallbackCaption,
      parse_mode: 'Markdown',
      ...(fbButtons.length > 0 ? Markup.inlineKeyboard(fbButtons) : {}),
    });
  } else {
    await ctx.reply(fallbackCaption, { parse_mode: 'Markdown', ...cancelKeyboard });
  }
});

module.exports = bot;