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

var mainMenu = Markup.inlineKeyboard([
  [Markup.button.callback('⬆️ ПОПОЛНИТЬ', 'menu_deposit'), Markup.button.callback('⬇️ ВЫВОД', 'menu_withdraw')],
  [Markup.button.callback('📜 История', 'menu_history'), Markup.button.callback('👤 Поддержка', 'menu_support')],
]);

var checkSubscription = async function(ctx) {
  try {
    var member = await ctx.telegram.getChatMember(process.env.REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('Subscription check error:', err.message);
    return false;
  }
};

var stage = new Scenes.Stage([depositScene, withdrawalScene]);
bot.use(session());
bot.use(stage.middleware());

bot.use(async function(ctx, next) {
  if (ctx.from) {
    try {
      await txnService.upsertUser(ctx.from);
      var blocked = await txnService.isUserBlocked(ctx.from.id);
      if (blocked) return ctx.reply(T.userBlocked);
    } catch (err) { console.error('Middleware error:', err); }
  }
  return next();
});

bot.use(async function(ctx, next) {
  if (ctx.message && ctx.message.text === '/start') return next();
  if (ctx.callbackQuery) return next();
  if (ctx.from) {
    var isSubscribed = await checkSubscription(ctx);
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

bot.start(async function(ctx) {
  var name = getUserName(ctx).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  var isSubscribed = await checkSubscription(ctx);
  if (!isSubscribed) {
    await ctx.reply(
      '👋 Привет, ' + name + '!\n\n⛔ Для использования бота необходимо подписаться на наш канал!',
      Markup.inlineKeyboard([
        [Markup.button.url('📢 Подписаться на канал', 'https://t.me/' + process.env.REQUIRED_CHANNEL.replace('@', ''))],
        [Markup.button.callback('✅ Я подписался', 'check_subscription')],
      ])
    );
    return;
  }
  await ctx.reply(T.welcome(name), { parse_mode: 'Markdown', ...mainMenu });
});

bot.command('cancel', async function(ctx) {
  await sessionService.clearSession(ctx.from.id);
  await ctx.scene.leave();
  await ctx.reply('❌ Отменено', mainMenu);
});

// ─── Inline menu handlers ─────────────────────────────────────────────────
bot.action('menu_deposit', async function(ctx) {
  await ctx.answerCbQuery();
  var rateLimit = require('../services/rateLimit');
  var check = await rateLimit.checkRateLimit(ctx.from.id, 'deposit');
  if (!check.allowed) return ctx.reply(check.message);
  return ctx.scene.enter('deposit');
});

bot.action('menu_withdraw', async function(ctx) {
  await ctx.answerCbQuery();
  var rateLimit = require('../services/rateLimit');
  var check = await rateLimit.checkRateLimit(ctx.from.id, 'withdrawal');
  if (!check.allowed) return ctx.reply(check.message);
  return ctx.scene.enter('withdrawal');
});

bot.action('menu_history', async function(ctx) {
  await ctx.answerCbQuery();
  var transactions = await txnService.getUserTransactions(ctx.from.id, 5);
  if (transactions.length === 0) return ctx.reply('📜 У вас ещё нет транзакций.');
  var statusEmoji = { pending: '⏳', processing: '🔄', completed: '✅', rejected: '❌', expired: '⏰' };
  var typeLabel = { deposit: 'Пополнение', withdrawal: 'Вывод' };
  var lines = transactions.map(function(t) {
    return (statusEmoji[t.status] || '❓') + ' ' + typeLabel[t.type] + ' ' + t.amount + ' сом | ' + (t.bookmaker ? t.bookmaker.toUpperCase() : '') + ' | ' + formatDate(t.created_at);
  });
  await ctx.reply('📜 Последние транзакции:\n\n' + lines.join('\n'));
});

bot.action('menu_support', async function(ctx) {
  await ctx.answerCbQuery();
  await ctx.reply('👤 Поддержка: @maximusbos\nРаботаем 24/7! 🔥');
});

// ─── Keep text button handlers as fallback ────────────────────────────────
bot.hears(T.btn.deposit, async function(ctx) {
  var rateLimit = require('../services/rateLimit');
  var check = await rateLimit.checkRateLimit(ctx.from.id, 'deposit');
  if (!check.allowed) return ctx.reply(check.message);
  return ctx.scene.enter('deposit');
});

bot.hears(T.btn.withdraw, async function(ctx) {
  var rateLimit = require('../services/rateLimit');
  var check = await rateLimit.checkRateLimit(ctx.from.id, 'withdrawal');
  if (!check.allowed) return ctx.reply(check.message);
  return ctx.scene.enter('withdrawal');
});

bot.hears(T.btn.support, function(ctx) { ctx.reply('👤 Поддержка: @maximusbos\nРаботаем 24/7! 🔥'); });

bot.hears(T.btn.cancel, async function(ctx) {
  await sessionService.clearSession(ctx.from.id);
  await ctx.scene.leave();
  await ctx.reply('❌ Отменено', mainMenu);
});

bot.hears(T.btn.history, async function(ctx) {
  var transactions = await txnService.getUserTransactions(ctx.from.id, 5);
  if (transactions.length === 0) return ctx.reply('📜 У вас ещё нет транзакций.');
  var statusEmoji = { pending: '⏳', processing: '🔄', completed: '✅', rejected: '❌', expired: '⏰' };
  var typeLabel = { deposit: 'Пополнение', withdrawal: 'Вывод' };
  var lines = transactions.map(function(t) {
    return (statusEmoji[t.status] || '❓') + ' ' + typeLabel[t.type] + ' ' + t.amount + ' сом | ' + (t.bookmaker ? t.bookmaker.toUpperCase() : '') + ' | ' + formatDate(t.created_at);
  });
  await ctx.reply('📜 Последние транзакции:\n\n' + lines.join('\n'));
});

// ─── Payment method buttons (legacy fallback) ─────────────────────────────
var paymentLinks = {
  pay_mbank: { name: 'MBANK', getLink: function() { return 'https://app.mbank.kg/qr/#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6'; } },
  'pay_kompanion': { name: 'KOMPANION', getLink: function() { return 'https://24.kompanion.kg/qr/#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6'; } },
  pay_bakai: { name: 'BAKAI', getLink: function() { return 'https://bakai.app/qr/#00020101021132590015qr.demirbank.kg01047001101611800003896513311202111302125204482953034175909DEMIRBANK6304dcb6'; } },
};

Object.entries(paymentLinks).forEach(function(entry) {
  var action = entry[0];
  var name = entry[1].name;
  var getLink = entry[1].getLink;

  bot.action(action, async function(ctx) {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch (e) {}
    var session = await sessionService.getSession(ctx.from.id);
    var link = getLink();

    await sessionService.updateSession(ctx.from.id, {
      paymentMethod: name,
      awaitingReceipt: true,
      bookmaker: session.bookmaker,
      accountId: session.accountId,
      amount: session.amount,
      finalAmount: session.finalAmount,
      formattedTotal: session.formattedTotal,
    });

    var displayAmount = session.finalAmount
      ? session.finalAmount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : formatAmount(session.amount);

    await ctx.reply(
      '✅ ' + name + '\n\n' +
      '💰 Сумма к оплате: ' + displayAmount + ' сом\n\n' +
      '⚠️ Обязательно переведите точную сумму (с копейками)\n' +
      '✅ Отправьте чек об оплате в этот чат',
      Markup.inlineKeyboard([
        [Markup.button.url('💳 Оплатить ' + displayAmount + ' сом', link)]
      ])
    );
  });
});

// ─── Receipt handler ──────────────────────────────────────────────────────
bot.on('photo', async function(ctx) {
  var session = await sessionService.getSession(ctx.from.id);
  if (!session.awaitingReceipt) return;

  var photo = ctx.message.photo;
  var fileId = photo[photo.length - 1].file_id;

  try {
    // Delete payment message
    if (session.paymentMessageId) {
      try { await ctx.telegram.deleteMessage(ctx.from.id, session.paymentMessageId); } catch (e) {}
    }

    var txn = await txnService.createDeposit({
      telegramId: ctx.from.id,
      bookmaker: session.bookmaker,
      accountId: session.accountId,
      amount: session.amount,
      finalAmount: session.finalAmount,
      paymentMethod: session.paymentMethod,
    });

    await txnService.attachReceipt(txn.id, fileId);

    var adminCaption =
      '🆕 НОВОЕ ПОПОЛНЕНИЕ\n\n' +
      '👤 ' + (ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name) + '\n' +
      '💰 Сумма: ' + formatAmount(session.finalAmount) + ' сом\n' +
      '🏦 Букмекер: ' + session.bookmaker + '\n' +
      '🆔 Аккаунт: ' + session.accountId + '\n' +
      '💳 Способ: ' + (session.paymentMethod ? session.paymentMethod.toUpperCase() : '') + '\n' +
      '📋 ID: ' + txn.id;

    var adminMsg = await ctx.telegram.sendPhoto(
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
      '⏳ Ожидайте подтверждения. Обычно 10 сек – 1 мин.',
      mainMenu
    );

    await sessionService.clearSession(ctx.from.id);
  } catch (err) {
    console.error('Receipt handler error:', err);
    await ctx.reply(T.errorGeneral);
  }
});

// ─── Check subscription ───────────────────────────────────────────────────
bot.action('check_subscription', async function(ctx) {
  await ctx.answerCbQuery();
  var isSubscribed = await checkSubscription(ctx);
  if (isSubscribed) {
    await ctx.editMessageText('✅ Спасибо за подписку! Теперь вы можете пользоваться ботом.');
    var name = getUserName(ctx).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    await ctx.reply(T.welcome(name), { parse_mode: 'Markdown', ...mainMenu });
  } else {
    await ctx.answerCbQuery('❌ Вы ещё не подписались!', { show_alert: true });
  }
});

// ─── Admin: approve ───────────────────────────────────────────────────────
bot.action(/^approve_(.+)$/, async function(ctx) {
  var txnId = ctx.match[1];
  try {
    var txn = await txnService.getTransaction(txnId);
    if (!txn) return ctx.answerCbQuery('❌ Транзакция не найдена');
    if (txn.status === 'completed') return ctx.answerCbQuery('Уже подтверждено ✅');
    if (txn.status === 'expired') return ctx.answerCbQuery('⏰ Заявка истекла');

    await ctx.answerCbQuery('⏳ Обрабатываем...');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    var xbetApi = require('../services/xbetApi');

    var balanceData = await xbetApi.getCashdeskBalance();
    if (balanceData && (balanceData.success || balanceData.Success)) {
      var balance = parseFloat(balanceData.balance || balanceData.Balance || 0);
      var needed = parseFloat(txn.final_amount || txn.amount);
      if (balance < needed) {
        return ctx.reply(
          '❌ Недостаточно средств на кассе!\n\nБаланс: ' + balance.toFixed(2) + '\nНужно: ' + needed.toFixed(2) + '\n\nПополните кассу и попробуйте снова.'
        );
      }
    }

    if (txn.type === 'deposit') {
      var result = await xbetApi.depositToPlayer(txn.bookmaker_account_id, txn.amount);
      console.log('DEPOSIT API RESULT:', JSON.stringify(result));

      if (!result.success) {
        await ctx.reply(
          '❌ Ошибка API!\nАккаунт: ' + txn.bookmaker_account_id + '\nСумма: ' + txn.amount + ' сом\nОшибка: ' + result.error,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Снова', 'approve_' + txn.id), Markup.button.callback('✅ Вручную', 'force_' + txn.id)],
            [Markup.button.callback('❌ Отклонить', 'reject_' + txn.id)],
          ])
        );
        return;
      }

      await txnService.approveTransaction(txnId, ctx.from.id);

      var originalTxn = await db.getOne('SELECT admin_note FROM transactions WHERE id = $1', [txnId]);
      if (originalTxn && originalTxn.admin_note) {
        var caption = '✅ ПОДТВЕРЖДЕНО\n\n👤 ' + (ctx.from.username ? '@' + ctx.from.first_name : 'Админ') + '\n💰 ' + (result.summa || txn.amount) + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + '\n🆔 ' + txn.bookmaker_account_id;
        await ctx.telegram.editMessageCaption(process.env.ADMIN_CHAT_ID, parseInt(originalTxn.admin_note), null, caption, { reply_markup: { inline_keyboard: [] } }).catch(function() {});
      }

      await ctx.telegram.sendMessage(txn.user_id, '✅ Ваш счёт пополнен!\n💰 ' + (result.summa || txn.amount) + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + ' ID: ' + txn.bookmaker_account_id, mainMenu).catch(function() {});

    } else if (txn.type === 'withdrawal') {
      var wResult = await xbetApi.payoutFromPlayer(txn.bookmaker_account_id, txn.withdrawal_code);
      if (!wResult.success) {
        await ctx.reply('❌ Ошибка выплаты: ' + wResult.error,
          Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Снова', 'approve_' + txn.id), Markup.button.callback('✅ Вручную', 'force_' + txn.id)],
            [Markup.button.callback('❌ Отклонить', 'reject_' + txn.id)],
          ])
        );
        return;
      }
      await txnService.approveTransaction(txnId, ctx.from.id);
      await ctx.telegram.sendMessage(txn.user_id, '✅ Выплата выполнена!\n💰 ' + wResult.summa + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : ''), mainMenu).catch(function() {});
      await ctx.reply('✅ Выплата: ' + txn.bookmaker_account_id + ' | ' + wResult.summa + ' сом');
    }
  } catch (err) {
    console.error('Approve error:', err);
    await ctx.reply('❌ Ошибка. Попробуйте снова.');
  }
});

// ─── Force approve ────────────────────────────────────────────────────────
bot.action(/^force_(.+)$/, async function(ctx) {
  var txnId = ctx.match[1];
  try {
    var txn = await txnService.getTransaction(txnId);
    if (!txn) return ctx.answerCbQuery('❌ Не найдена');
    await txnService.approveTransaction(txnId, ctx.from.id);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.answerCbQuery('✅ Подтверждено');
    await ctx.telegram.sendMessage(txn.user_id, '✅ Заявка подтверждена!\n💰 ' + txn.amount + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : ''), mainMenu).catch(function() {});
  } catch (err) { console.error('Force approve error:', err); }
});

// ─── Admin: reject ────────────────────────────────────────────────────────
bot.action(/^reject_(.+)$/, async function(ctx) {
  var txnId = ctx.match[1];
  try {
    var txn = await txnService.getTransaction(txnId);
    if (!txn) return ctx.answerCbQuery('❌ Не найдена');
    if (txn.status === 'rejected') return ctx.answerCbQuery('Уже отклонено');
    if (txn.status === 'expired') return ctx.answerCbQuery('⏰ Истекло');

    var savedMsgId = txn.admin_note;
    await txnService.rejectTransaction(txnId, ctx.from.id, 'Отклонено администратором');
    await ctx.answerCbQuery('❌ Отклонено');

    if (savedMsgId && process.env.ADMIN_CHAT_ID) {
      var rCaption = '❌ ОТКЛОНЕНО\n\n👤 ' + txn.user_id + '\n💰 ' + txn.amount + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + '\n🆔 ' + txn.bookmaker_account_id;
      await ctx.telegram.editMessageCaption(process.env.ADMIN_CHAT_ID, parseInt(savedMsgId), null, rCaption, { reply_markup: { inline_keyboard: [] } }).catch(function() {});
    } else {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(function() {});
    }

    await ctx.telegram.sendMessage(txn.user_id, '❌ Заявка отклонена.\nПричина: Отклонено администратором.\nПомощь: @maximusbos', mainMenu).catch(function() {});
  } catch (err) {
    console.error('Reject error:', err);
    await ctx.answerCbQuery('❌ Ошибка');
  }
});

// ─── SMS handler ──────────────────────────────────────────────────────────
var smsParser = require('../services/smsParser');

bot.on('text', async function(ctx, next) {
  var adminIds = (process.env.ADMIN_IDS || '').split(',').map(function(id) { return parseInt(id.trim()); });
  if (!adminIds.includes(ctx.from.id)) return next();

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

    if (depositResult.success) {
      await txnService.approveTransaction(matched.id, ctx.from.id);

      var origTxn = await db.getOne('SELECT admin_note FROM transactions WHERE id = $1', [matched.id]);
      if (origTxn && origTxn.admin_note && process.env.ADMIN_CHAT_ID) {
        var smsCaption = '✅ АВТО-ПОДТВЕРЖДЕНО\n\n👤 ' + (matched.username ? '@' + matched.username : matched.full_name) + '\n💰 ' + matched.amount + ' сом\n🏦 ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '') + '\n🆔 ' + matched.bookmaker_account_id + '\n\n⚡ Авто через банк';
        await ctx.telegram.editMessageCaption(process.env.ADMIN_CHAT_ID, parseInt(origTxn.admin_note), null, smsCaption, { reply_markup: { inline_keyboard: [] } }).catch(function() {});
      }

      await ctx.telegram.sendMessage(matched.user_id, '✅ Счёт пополнен автоматически!\n💰 ' + (depositResult.summa || matched.amount) + ' сом\n🏦 ' + (matched.bookmaker ? matched.bookmaker.toUpperCase() : '') + '\n⚡ Авто через банк', mainMenu).catch(function() {});
      await ctx.reply('✅ Авто-подтверждено! ' + (matched.username ? '@' + matched.username : matched.full_name) + ' | ' + amount + ' сом');
    } else {
      await txnService.approveTransaction(matched.id, ctx.from.id);
      await ctx.telegram.sendMessage(matched.user_id, '✅ Счёт пополнен!\n💰 ' + matched.amount + ' сом', mainMenu).catch(function() {});
      await ctx.reply('✅ Банк подтвердил, но API ошибка: ' + depositResult.error + '\n' + matched.bookmaker_account_id + ' | ' + amount + ' сом');
    }
  } else {
    await smsParser.saveBankNotification(text, amount, senderName, null);
    await ctx.reply('💳 Поступление: ' + amount + ' сом\n👤 От: ' + (senderName || '?') + '\n❌ Нет совпадений');
  }
});

// ─── Auto-expire ──────────────────────────────────────────────────────────
setInterval(async function() {
  try {
    var expired = await db.getMany("SELECT t.*, u.telegram_id, u.username, u.full_name FROM transactions t JOIN users u ON t.user_id = u.telegram_id WHERE t.type = 'deposit' AND t.status IN ('pending', 'processing') AND t.created_at <= NOW() - INTERVAL '10 minutes' LIMIT 10");
    for (var i = 0; i < expired.length; i++) {
      var txn = expired[i];
      await db.query("UPDATE transactions SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'processing')", [txn.id]);
      if (txn.admin_note && process.env.ADMIN_CHAT_ID) {
        var expCaption = '⏰ ИСТЕКЛО\n\n👤 ' + (txn.username ? '@' + txn.username : txn.full_name) + '\n💰 ' + txn.amount + ' сом\n🏦 ' + (txn.bookmaker ? txn.bookmaker.toUpperCase() : '') + '\n🆔 ' + txn.bookmaker_account_id;
        await bot.telegram.editMessageCaption(process.env.ADMIN_CHAT_ID, parseInt(txn.admin_note), null, expCaption, { reply_markup: { inline_keyboard: [] } }).catch(function() {});
      }
      await bot.telegram.sendMessage(txn.user_id, '⏰ Заявка истекла.\n💰 ' + txn.amount + ' сом не подтверждено.\n\nЕсли оплатили — @maximusbos\nЕсли нет — создайте новую.', mainMenu).catch(function() {});
    }
  } catch (err) { console.error('Expiry error:', err); }
}, 60000);

// ─── Wallet with QR generation + deep link ────────────────────────────────
bot.action(/^wallet_(\d+)$/, async function(ctx) {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  var walletId = ctx.match[1];
  var session = await sessionService.getSession(ctx.from.id);

  var wallet;
  try { wallet = await db.getOne('SELECT * FROM wallets WHERE id = $1', [walletId]); } catch (err) { console.error('Wallet error:', err.message); }

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

  if (wallet && wallet.qr_data && session.finalAmount) {
    try {
      var qrGen = require('../services/qrGenerator');
      var qrResult = await qrGen.generateQR(wallet.qr_data, session.finalAmount);

      var bankKey = Object.keys(bankLinks).find(function(k) { return wallet.bank.toLowerCase().includes(k); });
      var baseUrl = bankKey ? bankLinks[bankKey] : null;

      var buttons = [];
      if (baseUrl) {
        buttons.push([Markup.button.url('💳 Оплатить ' + displayAmount + ' сом', baseUrl + qrResult.qrString)]);
      }

      var caption = '✅ ' + walletName + '\n\n💰 Сумма к оплате: ' + displayAmount + ' сом\n\n⚠️ Обязательно переведите точную сумму\n✅ Отправьте чек в этот чат\n⏳ Актуально 10 минут';

      var payMsg = await ctx.replyWithPhoto(
        { source: qrResult.buffer, filename: 'qr.png' },
        { caption: caption, ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}) }
      );

      if (payMsg) {
        await sessionService.updateSession(ctx.from.id, { paymentMessageId: payMsg.message_id });
      }
      return;
    } catch (err) { console.error('QR gen error:', err.message); }
  }

  var fbCaption = '✅ ' + walletName + '\n\n💰 Сумма к оплате: ' + displayAmount + ' сом\n\n⚠️ Обязательно переведите точную сумму\n✅ Отправьте чек в этот чат\n⏳ Актуально 10 минут';

  if (wallet && wallet.qr_file_id) {
    var fbButtons = [];
    if (wallet.qr_link) { fbButtons.push([Markup.button.url('💳 Открыть ' + walletName, wallet.qr_link)]); }
    var fbMsg = await ctx.replyWithPhoto(wallet.qr_file_id, {
      caption: fbCaption,
      ...(fbButtons.length > 0 ? Markup.inlineKeyboard(fbButtons) : {}),
    });
    if (fbMsg) { await sessionService.updateSession(ctx.from.id, { paymentMessageId: fbMsg.message_id }); }
  } else {
    await ctx.reply(fbCaption, cancelKeyboard);
  }
});

module.exports = bot;