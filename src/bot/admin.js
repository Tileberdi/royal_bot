const { Markup } = require('telegraf');
const db = require('../db');
const txnService = require('../services/transaction');
const { formatDate, formatAmount } = require('../utils/helpers');
require('dotenv').config();

const sessionService = require('../services/session'); 

const safeName = (u) => {
  const name = u.username ? `@${u.username}` : (u.full_name || 'User');
  return name.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/\[/g, '\\[');
};
// ─── Check if user is admin ───────────────────────────────────────────────
const isAdmin = (ctx) => {
  const adminIds = process.env.ADMIN_IDS
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(Boolean);
  return adminIds.includes(ctx.from.id);
};

// ─── Admin-only middleware ────────────────────────────────────────────────
const adminOnly = (ctx, next) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('🚫 Нет доступа');
  }
  return next();
};

module.exports = (bot) => {

  // ── 📢 Broadcast ──────────────────────────────────────────────────────
  bot.hears('📢 Рассылка', adminOnly, async (ctx) => {
    await ctx.reply(
      `📢 *Рассылка всем пользователям*\n\n` +
      `Напишите сообщение которое хотите отправить всем.\n` +
      `Поддерживается текст, фото, видео.\n\n` +
      `Для отмены нажмите ⬅️ Отмена`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['⬅️ Отмена']]).resize(),
      }
    );

    const sessionService = require('../services/session');
    await sessionService.updateSession(ctx.from.id, { adminAction: 'broadcast' });
  });

  // ── Handle broadcast message ──────────────────────────────────────────
  bot.on(['text', 'photo', 'video'], async (ctx, next) => {
    if (!isAdmin(ctx)) return next();

    const sessionService = require('../services/session');
    const session = await sessionService.getSession(ctx.from.id);

    if (session.adminAction !== 'broadcast') return next();

    const text = ctx.message?.text;

    // Cancel
    if (text === '⬅️ Отмена') {
      await sessionService.clearSession(ctx.from.id);
      return ctx.reply('❌ Рассылка отменена.', Markup.keyboard([
        ['📊 Статистика', '📋 Очередь заявок'],
        ['👥 Пользователи', '🔍 Найти транзакцию'],
        ['🚫 Заблокировать', '✅ Разблокировать'],
        ['💰 Дневной отчёт', '🏦 Баланс кассы'],
        ['📢 Рассылка'],
        ['⬅️ Выйти'],
      ]).resize());
    }

    await sessionService.clearSession(ctx.from.id);

    // Get all non-blocked users
    const users = await db.getMany(
      'SELECT telegram_id FROM users WHERE is_blocked = false ORDER BY created_at ASC'
    );

    if (users.length === 0) {
      return ctx.reply('👥 Нет пользователей для рассылки.');
    }

    // Send progress message
    const progressMsg = await ctx.reply(
      `📢 Начинаем рассылку...\n👥 Всего пользователей: *${users.length}*`,
      { parse_mode: 'Markdown' }
    );

    let success = 0;
    let failed = 0;
    let blocked = 0;

    for (const user of users) {
      try {
        // Skip sending to the admin themselves
        if (user.telegram_id === ctx.from.id) {
          success++;
          continue;
        }

        if (ctx.message.photo) {
          // Photo message
          const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
          const caption = ctx.message.caption || '';
          await ctx.telegram.sendPhoto(user.telegram_id, photo, {
            caption,
            parse_mode: 'Markdown',
          });
        } else if (ctx.message.video) {
          // Video message
          const video = ctx.message.video.file_id;
          const caption = ctx.message.caption || '';
          await ctx.telegram.sendVideo(user.telegram_id, video, {
            caption,
            parse_mode: 'Markdown',
          });
        } else {
          // Text message
          await ctx.telegram.sendMessage(user.telegram_id, text, {
            parse_mode: 'Markdown',
          });
        }

        success++;

        // Update progress every 20 users
        if (success % 20 === 0) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            progressMsg.message_id,
            null,
            `📢 Рассылка в процессе...\n` +
            `✅ Отправлено: *${success}*\n` +
            `❌ Ошибок: *${failed}*\n` +
            `🚫 Заблокировали бота: *${blocked}*`,
            { parse_mode: 'Markdown' }
          ).catch(() => { });
        }

        // Small delay to avoid Telegram rate limits
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (err) {
        if (err.message?.includes('blocked') || err.message?.includes('deactivated')) {
          blocked++;
          // Mark user as blocked in DB
          await db.query(
            'UPDATE users SET is_blocked = true WHERE telegram_id = $1',
            [user.telegram_id]
          ).catch(() => { });
        } else {
          failed++;
        }
      }
    }

    // Final report
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      progressMsg.message_id,
      null,
      `📢 *Рассылка завершена!*\n\n` +
      `👥 Всего: *${users.length}*\n` +
      `✅ Доставлено: *${success}*\n` +
      `🚫 Заблокировали бота: *${blocked}*\n` +
      `❌ Ошибок: *${failed}*`,
      { parse_mode: 'Markdown' }
    ).catch(() => { });

    // Return to admin menu
    await ctx.reply('👑 Панель администратора', Markup.keyboard([
      ['📊 Статистика', '📋 Очередь заявок'],
      ['👥 Пользователи', '🔍 Найти транзакцию'],
      ['🚫 Заблокировать', '✅ Разблокировать'],
      ['💰 Дневной отчёт', '🏦 Баланс кассы'],
      ['📢 Рассылка'],
      ['⬅️ Выйти'],
    ]).resize());
  });

  // ── /admin — main admin menu ──────────────────────────────────────────
  bot.command('admin', adminOnly, async (ctx) => {
    await ctx.reply(
      '👑 *Панель администратора*',
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          ['📊 Статистика', '📋 Очередь заявок'],
          ['👥 Пользователи', '🔍 Найти транзакцию'],
          ['🚫 Заблокировать', '✅ Разблокировать'],
          ['💰 Дневной отчёт', '🏦 Баланс кассы'],
          ['📢 Рассылка'],
          ['💳 Поступления'],
          ['⬅️ Выйти'],
        ]).resize(),
      }
    );
  });

  // ── Exit admin panel ──────────────────────────────────────────────────
  bot.hears('⬅️ Выйти', adminOnly, async (ctx) => {
    const T = require('../locales/ru');
    await ctx.reply('Главное меню', Markup.keyboard([
      [T.btn.deposit, T.btn.withdraw],
      [T.btn.history, T.btn.support],
    ]).resize());
  });

  // ── 📊 Statistics ─────────────────────────────────────────────────────
  bot.hears('📊 Статистика', adminOnly, async (ctx) => {
    const stats = await db.getOne(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS total_completed,
        COUNT(*) FILTER (WHERE status = 'pending' OR status = 'processing') AS total_pending,
        COUNT(*) FILTER (WHERE status = 'rejected') AS total_rejected,
        COUNT(*) FILTER (WHERE type = 'deposit' AND status = 'completed') AS deposits_done,
        COUNT(*) FILTER (WHERE type = 'withdrawal' AND status = 'completed') AS withdrawals_done,
        COALESCE(SUM(amount) FILTER (WHERE type = 'deposit' AND status = 'completed'), 0) AS total_deposited,
        COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal' AND status = 'completed'), 0) AS total_withdrawn,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today_count,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND status = 'completed'), 0) AS today_volume
      FROM transactions
    `);

    const users = await db.getOne(`SELECT COUNT(*) as total FROM users`);

    await ctx.reply(
      `📊 *Общая статистика*\n\n` +
      `👥 Всего пользователей: *${users.total}*\n\n` +
      `✅ Выполнено: *${stats.total_completed}*\n` +
      `⏳ В ожидании: *${stats.total_pending}*\n` +
      `❌ Отклонено: *${stats.total_rejected}*\n\n` +
      `⬆️ Пополнений: *${stats.deposits_done}* (${formatAmount(stats.total_deposited)} сом)\n` +
      `⬇️ Выводов: *${stats.withdrawals_done}* (${formatAmount(stats.total_withdrawn)} сом)\n\n` +
      `📅 За 24 часа: *${stats.today_count}* заявок | *${formatAmount(stats.today_volume)} сом*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── 📋 Pending queue ──────────────────────────────────────────────────
  bot.hears('📋 Очередь заявок', adminOnly, async (ctx) => {
    const pending = await db.getMany(`
      SELECT t.*, u.username, u.full_name
      FROM transactions t
      JOIN users u ON t.user_id = u.telegram_id
      WHERE t.status IN ('pending', 'processing')
      ORDER BY t.created_at ASC
      LIMIT 10
    `);

    if (pending.length === 0) {
      return ctx.reply('✅ Очередь пуста! Нет ожидающих заявок.');
    }

    await ctx.reply(`📋 *Ожидающие заявки: ${pending.length}*`, { parse_mode: 'Markdown' });

    for (const txn of pending) {
      const typeLabel = txn.type === 'deposit' ? '⬆️ Пополнение' : '⬇️ Вывод';
      const user = safeName(txn);

      const msg =
        `${typeLabel}\n` +
        `👤 ${user}\n` +
        `💰 ${txn.amount} сом | 🏦 ${txn.bookmaker?.toUpperCase()}\n` +
        `🆔 ${txn.bookmaker_account_id}\n` +
        `🕐 ${formatDate(txn.created_at)}\n` +
        `📋 \`${txn.id.substring(0, 8)}...\``;

      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Подтвердить', `approve_${txn.id}`),
            Markup.button.callback('❌ Отклонить', `reject_${txn.id}`),
          ],
        ]),
      });
    }
  });

  // ── 💰 Daily report ───────────────────────────────────────────────────
  bot.hears('💰 Дневной отчёт', adminOnly, async (ctx) => {
    const report = await db.getMany(`
      SELECT
        type,
        status,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as volume
      FROM transactions
      WHERE created_at >= CURRENT_DATE
      GROUP BY type, status
      ORDER BY type, status
    `);

    if (report.length === 0) {
      return ctx.reply('📅 Сегодня транзакций ещё не было.');
    }

    const statusEmoji = {
      completed: '✅', pending: '⏳',
      processing: '🔄', rejected: '❌', expired: '⏰',
    };
    const typeLabel = { deposit: '⬆️ Пополнение', withdrawal: '⬇️ Вывод' };

    const lines = report.map((r) =>
      `${statusEmoji[r.status]} ${typeLabel[r.type]}: *${r.count}* заявок | *${formatAmount(r.volume)} сом*`
    );

    await ctx.reply(
      `💰 *Отчёт за сегодня*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── 👥 Users list ─────────────────────────────────────────────────────
  bot.hears('👥 Пользователи', adminOnly, async (ctx) => {
    const users = await db.getMany(`
      SELECT u.*,
        COUNT(t.id) as txn_count,
        COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'completed'), 0) as total_volume
      FROM users u
      LEFT JOIN transactions t ON u.telegram_id = t.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 15
    `);

    if (users.length === 0) return ctx.reply('👥 Пользователей пока нет');

    const lines = users.map((u, i) => {
      const name = safeName(u);
      const blocked = u.is_blocked ? ' 🚫' : '';
      return `${i + 1}. ${name}${blocked} | ${u.txn_count} заявок | ${formatAmount(u.total_volume)} сом`;
    });

    await ctx.reply(
      `👥 *Последние пользователи:*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── 🔍 Find transaction ───────────────────────────────────────────────
  bot.hears('🔍 Найти транзакцию', adminOnly, async (ctx) => {
    await ctx.reply(
      '🔍 Введите ID транзакции или Telegram ID пользователя:',
      Markup.keyboard([['⬅️ Отмена']]).resize()
    );
    // Set admin search mode in session
    const sessionService = require('../services/session');
    await sessionService.updateSession(ctx.from.id, { adminSearching: true });
  });

  // ── 🚫 Block user ─────────────────────────────────────────────────────
  bot.hears('🚫 Заблокировать', adminOnly, async (ctx) => {
    await ctx.reply(
      '🚫 Введите Telegram ID пользователя для блокировки:',
      Markup.keyboard([['⬅️ Отмена']]).resize()
    );
    const sessionService = require('../services/session');
    await sessionService.updateSession(ctx.from.id, { adminAction: 'block' });
  });

  // ── ✅ Unblock user ───────────────────────────────────────────────────
  bot.hears('✅ Разблокировать', adminOnly, async (ctx) => {
    await ctx.reply(
      '✅ Введите Telegram ID пользователя для разблокировки:',
      Markup.keyboard([['⬅️ Отмена']]).resize()
    );
    const sessionService = require('../services/session');
    await sessionService.updateSession(ctx.from.id, { adminAction: 'unblock' });
  });

  // ── Handle admin text inputs (search / block / unblock) ───────────────
  bot.hears('⬅️ Отмена', adminOnly, async (ctx) => {
    const sessionService = require('../services/session');
    await sessionService.clearSession(ctx.from.id);
    await ctx.reply('👑 Панель администратора', Markup.keyboard([
      ['📊 Статистика', '📋 Очередь заявок'],
      ['👥 Пользователи', '🔍 Найти транзакцию'],
      ['🚫 Заблокировать', '✅ Разблокировать'],
      ['💰 Дневной отчёт', '🏦 Баланс кассы'],
      ['⬅️ Выйти'],
    ]).resize());
  });

  // Add this handler:
  bot.hears('🏦 Баланс кассы', adminOnly, async (ctx) => {
    const xbetApi = require('../services/xbetApi');
    const result = await xbetApi.getCashdeskBalance();

    if (!result.success) {
      return ctx.reply(`❌ Ошибка получения баланса: ${result.error}`);
    }

    await ctx.reply(
      `🏦 *Баланс кассы*\n\n` +
      `💰 Наличных в кассе: *${result.balance} сом*\n` +
      `📊 Лимит кассы: *${result.limit} сом*`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('testapi', adminOnly, async (ctx) => {
    const xbetApi = require('../services/xbetApi');

    await ctx.reply('⏳ Тестируем подключение к API...');

    const balance = await xbetApi.getCashdeskBalance();
    const player = await xbetApi.findPlayer('1565838763');

    await ctx.reply(
      `🔌 *Тест API*\n\n` +
      `🏦 Баланс кассы:\n` +
      `Результат: ${JSON.stringify(balance)}\n\n` +
      `👤 Поиск игрока 1565838763:\n` +
      `Результат: ${JSON.stringify(player)}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.hears('💳 Поступления', adminOnly, async (ctx) => {
  const smsParser = require('../services/smsParser');
  const unmatched = await smsParser.getUnmatched(10);

  if (unmatched.length === 0) {
    return ctx.reply('✅ Нет непривязанных поступлений за 24 часа.');
  }

  await ctx.reply(`💳 *Непривязанные поступления: ${unmatched.length}*`, { parse_mode: 'Markdown' });

  for (const n of unmatched) {
    await ctx.reply(
      `💰 ${n.amount} сом\n` +
      `👤 От: ${n.sender_name || 'неизвестно'}\n` +
      `🕐 ${formatDate(n.received_at)}\n` +
      `📋 SMS: ${n.raw_text.substring(0, 100)}...`
    );
  }
});

  // ── Text handler for admin actions ────────────────────────────────────
  bot.on('text', async (ctx, next) => {
    // Only handle if this is an admin
    if (!isAdmin(ctx)) return next();

    const sessionService = require('../services/session');
    const session = await sessionService.getSession(ctx.from.id);
    const text = ctx.message.text.trim();

    // Skip admin handler if user is in deposit/withdrawal flow
    const adminMenuButtons = [
      '📊 Статистика', '📋 Очередь заявок', '👥 Пользователи',
      '🔍 Найти транзакцию', '🚫 Заблокировать', '✅ Разблокировать',
      '💰 Дневной отчёт', '⬅️ Выйти', '⬅️ Отмена',
    ];

    // If not in an admin action AND not pressing an admin button, pass through
    if (!session.adminSearching && !session.adminAction && !adminMenuButtons.includes(text)) {
      return next();
    }

    // ── Search
    if (session.adminSearching) {
      await sessionService.clearSession(ctx.from.id);

      if (text.includes('-')) {
        const txn = await txnService.getTransaction(text);
        if (!txn) return ctx.reply('❌ Транзакция не найдена.');

        const statusEmoji = {
          completed: '✅', pending: '⏳',
          processing: '🔄', rejected: '❌', expired: '⏰',
        };

        return ctx.reply(
          `🔍 *Транзакция найдена*\n\n` +
          `📋 ID: \`${txn.id}\`\n` +
          `${statusEmoji[txn.status]} Статус: ${txn.status}\n` +
          `${txn.type === 'deposit' ? '⬆️' : '⬇️'} Тип: ${txn.type}\n` +
          `💰 Сумма: ${txn.amount} сом\n` +
          `🏦 ${txn.bookmaker?.toUpperCase()} | ID: ${txn.bookmaker_account_id}\n` +
          `👤 User ID: ${txn.user_id}\n` +
          `🕐 ${formatDate(txn.created_at)}`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [
                Markup.button.callback('✅ Подтвердить', `approve_${txn.id}`),
                Markup.button.callback('❌ Отклонить', `reject_${txn.id}`),
              ],
            ]),
          }
        );
      }

      const userId = parseInt(text);
      if (isNaN(userId)) return ctx.reply('❌ Неверный формат.');

      const userTxns = await txnService.getUserTransactions(userId, 5);
      if (userTxns.length === 0) return ctx.reply('❌ Транзакции не найдены.');

      const lines = userTxns.map((t) =>
        `${t.type === 'deposit' ? '⬆️' : '⬇️'} ${t.amount} сом | ` +
        `${t.bookmaker?.toUpperCase()} | ${t.status} | ${formatDate(t.created_at)}`
      );

      return ctx.reply(
        `🔍 *Транзакции пользователя ${userId}:*\n\n${lines.join('\n')}`,
        { parse_mode: 'Markdown' }
      );
    }

    // ── Block / Unblock
    if (session.adminAction === 'block' || session.adminAction === 'unblock') {
      const targetId = parseInt(text);
      if (isNaN(targetId)) return ctx.reply('❌ Неверный Telegram ID.');

      const shouldBlock = session.adminAction === 'block';
      await sessionService.clearSession(ctx.from.id);

      await db.query(
        'UPDATE users SET is_blocked = $1, updated_at = NOW() WHERE telegram_id = $2',
        [shouldBlock, targetId]
      );

      await db.query(
        'INSERT INTO admin_logs (admin_id, action, target_id) VALUES ($1, $2, $3)',
        [ctx.from.id, session.adminAction, String(targetId)]
      );

      const action = shouldBlock ? '🚫 Заблокирован' : '✅ Разблокирован';
      await ctx.reply(`${action}: ${targetId}`);

      try {
        const msg = shouldBlock
          ? '🚫 Ваш аккаунт заблокирован. Обратитесь: @albereinst'
          : '✅ Ваш аккаунт разблокирован.';
        await ctx.telegram.sendMessage(targetId, msg);
      } catch (e) { }

      return ctx.reply('👑 Панель администратора', Markup.keyboard([
        ['📊 Статистика', '📋 Очередь заявок'],
        ['👥 Пользователи', '🔍 Найти транзакцию'],
        ['🚫 Заблокировать', '✅ Разблокировать'],
        ['💰 Дневной отчёт', '🏦 Баланс кассы'],
        ['💰 Дневной отчёт', '⬅️ Выйти'],
      ]).resize());
    }

    return next();
  });

  // ── Add wallet via Telegram ─────────────────────────────────
 // ── Add wallet via Telegram ─────────────────────────────────
  bot.command('addwallet', adminOnly, async (ctx) => {
    await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_name' });
    await ctx.reply('💳 Введите имя владельца кошелька:', Markup.keyboard([['⬅️ Отмена']]).resize());
  });

  // Handle addwallet flow
  bot.on('text', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const session = await sessionService.getSession(ctx.from.id);
    const text = ctx.message.text.trim();

    if (text === '⬅️ Отмена' && session.adminAction && session.adminAction.startsWith('addwallet')) {
      await sessionService.clearSession(ctx.from.id);
      return ctx.reply('❌ Отменено.', Markup.removeKeyboard());
    }

    if (session.adminAction === 'addwallet_name') {
      await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_bank', walletName: text });
      return ctx.reply('🏦 Выберите банк:', Markup.keyboard([
        ['MBank', 'Bakai'],
        ['Kompanion', 'Optima'],
        ['O!Деньги', 'Demir'],
        ['⬅️ Отмена'],
      ]).resize());
    }

    if (session.adminAction === 'addwallet_bank') {
      await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_qrdata', walletBank: text });
      return ctx.reply(
        '📋 Отправьте QR-данные кошелька (текстовая строка из QR):\n\n' +
        'Это длинная строка вроде: 0002010102115401032590015qr.kompanion.kg...\n\n' +
        'Чтобы получить её — отсканируйте свой QR через приложение "QR Reader"\n\n' +
        'Или отправьте /skip чтобы пропустить'
      );
    }

    if (session.adminAction === 'addwallet_qrdata') {
      var qrData = text.startsWith('http') ? null : text;
      await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_link', walletQrData: qrData });
      return ctx.reply(
        '🔗 Отправьте ссылку для оплаты (необязательно):\n\n' +
        'Или отправьте /skip чтобы пропустить'
      );
    }

    if (session.adminAction === 'addwallet_link') {
      var link = text.startsWith('http') ? text : null;
      await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_qr', walletLink: link });
      return ctx.reply('📸 Отправьте QR-код кошелька (фото):\n\nИли отправьте /skip чтобы пропустить');
    }

    return next();
  });

  // Handle QR photo for wallet
  bot.on('photo', async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const session = await sessionService.getSession(ctx.from.id);

    if (session.adminAction === 'addwallet_qr') {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

      try {
        await db.query(
          'INSERT INTO wallets (name, bank, qr_file_id, qr_link, qr_data) VALUES ($1, $2, $3, $4, $5)',
          [session.walletName, session.walletBank, fileId, session.walletLink || null, session.walletQrData || null]
        );

        await sessionService.clearSession(ctx.from.id);
        await ctx.reply(
          '✅ Кошелёк добавлен!\n\n' +
          '👤 ' + session.walletName + '\n' +
          '🏦 ' + session.walletBank + '\n' +
          '📸 QR сохранён\n' +
          (session.walletQrData ? '📋 QR-данные сохранены (авто-генерация)\n' : '') +
          '\nТеперь пользователи увидят этот кошелёк при пополнении.',
          Markup.removeKeyboard()
        );
      } catch (err) {
        console.error('Add wallet error:', err);
        await ctx.reply('❌ Ошибка сохранения кошелька.');
      }
      return;
    }

    return next();
  });

  // Skip steps
  bot.command('skip', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const session = await sessionService.getSession(ctx.from.id);

    if (session.adminAction === 'addwallet_qrdata') {
      await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_link', walletQrData: null });
      return ctx.reply('🔗 Отправьте ссылку для оплаты:\n\nИли /skip');
    }

    if (session.adminAction === 'addwallet_link') {
      await sessionService.updateSession(ctx.from.id, { adminAction: 'addwallet_qr', walletLink: null });
      return ctx.reply('📸 Отправьте QR-код (фото):\n\nИли /skip чтобы пропустить');
    }

    if (session.adminAction === 'addwallet_qr') {
      try {
        await db.query(
          'INSERT INTO wallets (name, bank, qr_link, qr_data) VALUES ($1, $2, $3, $4)',
          [session.walletName, session.walletBank, session.walletLink || null, session.walletQrData || null]
        );
        await sessionService.clearSession(ctx.from.id);
        await ctx.reply(
          '✅ Кошелёк добавлен!\n\n' +
          '👤 ' + session.walletName + '\n' +
          '🏦 ' + session.walletBank + '\n' +
          (session.walletQrData ? '📋 QR-данные сохранены (авто-генерация)\n' : '') +
          (session.walletLink ? '🔗 Ссылка сохранена\n' : ''),
          Markup.removeKeyboard()
        );
      } catch (err) {
        console.error('Add wallet error:', err);
        await ctx.reply('❌ Ошибка.');
      }
    }
  });

  // List wallets
  bot.command('wallets', adminOnly, async (ctx) => {
    try {
      const wallets = await db.getMany('SELECT * FROM wallets ORDER BY created_at DESC');

      if (wallets.length === 0) {
        return ctx.reply('💳 Нет кошельков.\n\nДобавьте: /addwallet');
      }

      var lines = wallets.map(function(w, i) {
        var status = w.is_active ? '🟢' : '🔴';
        var qr = w.qr_file_id ? '📸' : '—';
        var data = w.qr_data ? '📋' : '—';
        return (i + 1) + '. ' + status + ' ' + w.name + ' | ' + w.bank + ' | QR: ' + qr + ' | Data: ' + data;
      });

      await ctx.reply(
        '💳 *Кошельки (' + wallets.length + '):*\n\n' + lines.join('\n') + '\n\n' +
        'Добавить: /addwallet\n' +
        'Удалить: /delwallet [номер]',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await ctx.reply('❌ Ошибка загрузки кошельков.');
    }
  });

  // Delete wallet
  bot.command('delwallet', adminOnly, async (ctx) => {
    var args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('Использование: /delwallet [номер]\n\nСначала посмотрите /wallets');
    }

    try {
      var wallets = await db.getMany('SELECT * FROM wallets ORDER BY created_at DESC');
      var index = parseInt(args[1]) - 1;

      if (index < 0 || index >= wallets.length) {
        return ctx.reply('❌ Неверный номер.');
      }

      var wallet = wallets[index];
      await db.query('DELETE FROM wallets WHERE id = $1', [wallet.id]);

      await ctx.reply('🗑 Удалён: ' + wallet.name + ' (' + wallet.bank + ')');
    } catch (err) {
      await ctx.reply('❌ Ошибка удаления.');
    }
  });
};