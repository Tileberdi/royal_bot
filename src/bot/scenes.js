const { Scenes, Markup } = require('telegraf');
const T = require('../locales/ru');
const sessionService = require('../services/session');
const txnService = require('../services/transaction');
const { isValidAmount, isValidAccountId, formatAmount } = require('../utils/helpers');

const bookmakersKeyboard = Markup.keyboard([
  ['1XBET',],
  [T.btn.cancel],
]).resize();

const mainMenuKeyboard = Markup.keyboard([
  [T.btn.deposit, T.btn.withdraw],
          [T.btn.support],
]).resize();

const cancelKeyboard = Markup.keyboard([[T.btn.cancel]]).resize();

const handleCancel = async (ctx) => {
  await sessionService.clearSession(ctx.from.id);
  await ctx.scene.leave();
  await ctx.reply('❌ Отменено', mainMenuKeyboard);
};

// ═══════════════════════════════════════════════════════════════════════════
// DEPOSIT SCENE
// ═══════════════════════════════════════════════════════════════════════════

const depositScene = new Scenes.WizardScene(
  'deposit',

  // Step 0: Show bookmaker selection
  async (ctx) => {
    await sessionService.clearSession(ctx.from.id);
    await ctx.reply(T.selectBookmaker, bookmakersKeyboard);
    return ctx.wizard.next();
  },

  // Step 1: Get bookmaker → ask for account ID
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    const valid = ['1XBET', 'MELBET', '1WIN', 'MOSTBET'];
    if (!valid.includes(text)) {
      return ctx.reply('Пожалуйста, выберите букмекера из списка:', bookmakersKeyboard);
    }

    await sessionService.updateSession(ctx.from.id, { bookmaker: text });
    await ctx.reply(T.enterAccountId(text), {
      parse_mode: 'Markdown',
      ...cancelKeyboard,
    });
    return ctx.wizard.next();
  },

  // Step 2: Get account ID → ask for amount
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    if (!isValidAccountId(text)) return ctx.reply(T.invalidId);

    await sessionService.updateSession(ctx.from.id, { accountId: text });
    await ctx.reply(T.enterAmount, cancelKeyboard);
    return ctx.wizard.next();
  },

  // Step 3: Get amount → show payment methods
  // Step 3: Get amount → create transaction → show payment with unique amount
  // Step 3: Get amount → show payment with wallets from database
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    if (!isValidAmount(text)) return ctx.reply(T.invalidAmount);

    const amount = parseFloat(text);
    const session = await sessionService.getSession(ctx.from.id);
    const db = require('../db');

    // Generate unique kopecks (01-99)
    const kopecks = Math.floor(Math.random() * 98) + 1;
    const finalAmount = amount + (kopecks / 100);
    const formattedTotal = finalAmount.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    await sessionService.updateSession(ctx.from.id, {
      amount,
      finalAmount,
      formattedTotal,
    });

    // Get active wallets from database
    let wallets = [];
    try {
      const result = await db.getMany('SELECT * FROM wallets WHERE is_active = true ORDER BY id');
      wallets = result;
    } catch (err) {
      console.error('Wallets error:', err.message);
    }

    const caption =
      `✅ Сумма к оплате: 100.42` +
      `⚠️ Актуально в течение 10 минут`;
      

    // Build payment buttons from active wallets
    const buttons = [];
    if (wallets.length > 0) {
      // Group wallets into rows of 2
      for (let i = 0; i < wallets.length; i += 2) {
        const row = [];
        row.push(Markup.button.callback(`${wallets[i].bank.toUpperCase()} ↗`, `wallet_${wallets[i].id}`));
        if (wallets[i + 1]) {
          row.push(Markup.button.callback(`${wallets[i + 1].bank.toUpperCase()} ↗`, `wallet_${wallets[i + 1].id}`));
        }
        buttons.push(row);
      }
    } else {
      // Fallback to hardcoded buttons if no wallets in database
      buttons.push([
        Markup.button.callback('MBANK ↗', 'pay_mbank'),
        Markup.button.callback('O!Деньги ↗', 'pay_odeньги'),
      ]);
      buttons.push([
        Markup.button.callback('MegaPay ↗', 'pay_megapay'),
        Markup.button.callback('KOMPANION ↗', 'pay_kompanion'),
      ]);
      buttons.push([Markup.button.callback('BAKAI BANK ↗', 'pay_bakai')]);
    }

    // Send QR of first active wallet if available
    const primaryWallet = wallets.find(w => w.qr_file_id);
    if (primaryWallet && primaryWallet.qr_file_id) {
      await ctx.replyWithPhoto(primaryWallet.qr_file_id, {
        caption,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } else if (process.env.PAYMENT_QR_FILE_ID) {
      await ctx.replyWithPhoto(process.env.PAYMENT_QR_FILE_ID, {
        caption,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    } else {
      await ctx.reply(caption, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons),
      });
    }

    return ctx.scene.leave();
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// WITHDRAWAL SCENE
// ═══════════════════════════════════════════════════════════════════════════
const withdrawalScene = new Scenes.WizardScene(
  'withdrawal',

  // Step 0: Choose bookmaker
  async (ctx) => {
    await sessionService.clearSession(ctx.from.id);
    await ctx.reply(T.selectBookmaker, bookmakersKeyboard);
    return ctx.wizard.next();
  },

  // Step 1: Get bookmaker → ask for QR photo
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    const valid = ['1XBET', 'MELBET', '1WIN', 'MOSTBET'];
    if (!valid.includes(text)) {
      return ctx.reply('Пожалуйста, выберите букмекера из списка:', bookmakersKeyboard);
    }

    await sessionService.updateSession(ctx.from.id, { bookmaker: text });

    await ctx.reply(
      `📱 *Отправьте QR-код*\n\nСфотографируйте QR-код из приложения и отправьте его сюда 👇`,
      { parse_mode: 'Markdown', ...cancelKeyboard }
    );
    return ctx.wizard.next();
  },

  // Step 2: Receive QR photo → ask for recipient name
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    const photo = ctx.message?.photo;
    const document = ctx.message?.document;

    if (!photo && !document) {
      return ctx.reply('📱 Пожалуйста, отправьте фото QR-кода.', cancelKeyboard);
    }

    const fileId = photo
      ? photo[photo.length - 1].file_id
      : document.file_id;

    await sessionService.updateSession(ctx.from.id, { qrFileId: fileId });

    await ctx.reply('👤 Отправьте имя получателя', cancelKeyboard);
    return ctx.wizard.next();
  },

  // Step 3: Get recipient name → ask for 1xBet ID
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    if (!text || text.trim().length < 2) {
      return ctx.reply('❌ Введите имя получателя.');
    }

    await sessionService.updateSession(ctx.from.id, { recipientName: text.trim() });

    const session = await sessionService.getSession(ctx.from.id);
    await ctx.reply(T.enterAccountIdW(session.bookmaker), {
      parse_mode: 'Markdown',
      ...cancelKeyboard,
    });
    return ctx.wizard.next();
  },

  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);
    if (!isValidAccountId(text)) return ctx.reply(T.invalidId);

    await sessionService.updateSession(ctx.from.id, { accountId: text });

    // 💰 NEW: Ask for withdrawal amount
    await ctx.reply(
      `💰 *Введите сумму вывода*\n\n`,
      {
        parse_mode: 'Markdown',
        ...cancelKeyboard,
      }
    );
    return ctx.wizard.next();
  },

  // Step 4: Get 1xBet ID → show 7-step instructions → ask for code
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);
    if (!isValidAmount(text)) return ctx.reply(T.invalidId);
    const amount = parseFloat(text);

    // Validate amount range
    if (amount < 0) {
      return ctx.reply('❌ Неправильная сумма');
    }
    await sessionService.updateSession(ctx.from.id, { amount });

    const session = await sessionService.getSession(ctx.from.id);

    // Show the 7-step instructions
    await ctx.reply(T.withdrawInstructions(session.bookmaker), cancelKeyboard);

    // Ask for the special code
    await ctx.reply(
      `🔑 Введите код из приложения:\n_(Код из шага 6 выше)_`,
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // Step 5: Get special code → confirm + notify admin
  async (ctx) => {
    const text = ctx.message?.text;
    if (text === T.btn.cancel) return handleCancel(ctx);

    if (!text || text.trim().length < 2) {
      return ctx.reply('❌ Введите код из приложения.');
    }

    const withdrawalCode = text.trim();
    const session = await sessionService.getSession(ctx.from.id);
    const txnService = require('../services/transaction');

    // Create withdrawal — no amount needed, it's on the QR
    const txn = await txnService.createWithdrawal({
      telegramId: ctx.from.id,
      bookmaker: session.bookmaker,
      accountId: session.accountId,
      amount: session.amount,
      withdrawalCode,
    });

    // Save QR file_id to transaction
    if (session.qrFileId) {
      const db = require('../db');
      await db.query('UPDATE transactions SET qr_file_id = $1 WHERE id = $2', [session.qrFileId, txn.id]);
    }

    // Admin gets QR photo + all details
    const adminCaption =
      `🆕 *НОВЫЙ ВЫВОД*\n\n` +
      `👤 ${ctx.from.username ? '@' + ctx.from.username.replace(/_/g, '\\_') : ctx.from.first_name}\n` +
      `💰 Сумма: *${formatAmount(session.amount)} сом*\n` +
      `🏦 ${session.bookmaker}\n` +
      `🆔 ID: ${session.accountId}\n` +
      `👤 Получатель: ${session.recipientName}\n` +
      `🔑 Код: \`${withdrawalCode}\`\n` +
      `📋 Транзакция: \`${txn.id}\``;

    try {
      await ctx.telegram.sendPhoto(
        process.env.ADMIN_CHAT_ID,
        session.qrFileId,
        {
          caption: adminCaption,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Подтвердить', `approve_${txn.id}`),
              Markup.button.callback('❌ Отклонить', `reject_${txn.id}`),
            ],
          ]),
        }
      );
    } catch (err) {
      console.error('Admin notify error:', err.message);
    }

    // Confirm to user
    await ctx.reply(
      T.requestAccepted(session.accountId, withdrawalCode, formatAmount(session.amount)),
      mainMenuKeyboard
    );

    await sessionService.clearSession(ctx.from.id);
    return ctx.scene.leave();
  }
);

module.exports = { depositScene, withdrawalScene };