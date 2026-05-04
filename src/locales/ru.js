// At the very top of ru.js
const { formatAmount } = require('../utils/helpers');
module.exports = {
  // Welcome
  welcome: (name) => `Привет, ${name}! 👋\n\n` +
    `💰 *Пополнение и выводы*\n\n` +
    `💵 0% комиссии\n` +
    `🔒 Защищённые транзакции\n` +
    `⚡ Обработка: 10 сек – 1 мин\n` +
    `👤 Поддержка: @maximusbos\n\n` +
    `Работаем 24/7! 🔥`,

  // Main menu
  selectAction: '📋 Выберите нужное действие из меню ниже:',
  selectBookmaker: '📋 Пожалуйста, выберите букмекера:',
  selectPaymentMethod: '💳 Выберите способ оплаты:',

  // Deposit flow
  enterAccountId: (bookmaker) => `🏦 *Пополнение счёта ${bookmaker}*\n\nВведите номер счёта, с которого вносите средства (${bookmaker} ID)`,
  enterAccountIdW: (bookmaker) => `🏦 *Вывод со счёта ${bookmaker}*\n\nВведите номер счёта, с которого вносите средства (${bookmaker} ID)`,
  enterAmount: 'Теперь, пожалуйста, введите сумму:',
  paymentDetails: (amount, fee, total) =>
    `✅ Сумма к оплате: *${total} сом*\n` +
    `⚠️ Актуально в течение 10 минут.\n\n` +
    `✅ Сумма к оплате: *${total} сом*\n` +
    `⚠️ Обязательно переведите точную сумму (с копейками)\n` +
    `✅ Отправьте чек об оплате в этот чат`,
  sendQrCode: 'Отправьте QR-код',
  sendReceipt: '📸 Отправьте фото чека или скриншот оплаты:',

  // Withdrawal flow
  withdrawInstructions: (bookmaker) =>
    `Заходим 👇\n\n` +
    `🔴 1. Настройки!\n` +
    `🔴 2. Вывести со счёта!\n` +
    `🔴 3. Наличными!\n` +
    `🔴 4. Сумму для Вывода!\n` +
    `(Выбираем город, Бишкек Улица GLOBUS(24/7))\n` +
    `🔴 5. Подтвердить\n` +
    `🔴 6. Получить Код!\n` +
    `🔴 7. Отправить его нам`,
  enterWithdrawalCode: 'Введите код вывода из приложения:',

  // Status messages
  requestAccepted: (id, code, formattedAmount) =>
    `✅ Ваша заявка принята на проверку!\n\n` +
    `💰 Сумма: *${formattedAmount} сом*\n` +
    `🆔 ID XBET: ${id}\n` +
    `Код: ${code}\n\n` +
    `⚠️ Вывод занимает от 5 минут до 12 часов\n\n` +
    `Пожалуйста, подождите!\n\n` +
    `✅ Вы получите уведомление о зачислении средств!\n\n` +
    `Если возникли проблемы 👇\n` +
    `👤 Оператор: @maximusbos`,
  depositConfirmed: (amount, id) =>
    `Ваш счет пополнен✅ (27 s)\nСумма: -${amount} сом\nXBET ID: ${id}`,
  transactionExpired: '⏰ Время на оплату истекло. Начните заново',
  transactionRejected: (reason) => `❌ Ваша заявка отклонена\nПричина: ${reason}`,

  // Errors
  invalidAmount: '❌ Сумма не может быть меньше 35',
  invalidId: '❌ Неверный ID. Попробуйте ещё раз',
  userBlocked: '🚫 Ваш аккаунт заблокирован. Обратитесь в поддержку: @maximusbos',
  errorGeneral: '❌ Произошла ошибка. Попробуйте ещё раз или напишите @maximusbos',

  // Buttons
  btn: {
    deposit: '⬆️ ПОПОЛНИТЬ',
    withdraw: '⬇️ ВЫВОД',
    cancel: '❌ Отмена',
    back: '⬅️ Назад',
    history: '📜 История',
    support: '👤 Поддержка',
    confirm: '✅ Подтвердить',
  },

  // Admin
  admin: {
    newDeposit: (user, amount, bookmaker, accountId, txnId) =>
      `🆕 *НОВОЕ ПОПОЛНЕНИЕ*\n\n` +
      `👤 Пользователь: ${user}\n` +
      `💰 Сумма: ${amount} сом\n` +
      `🏦 Букмекер: ${bookmaker}\n` +
      `🆔 Аккаунт: ${accountId}\n` +
      `📋 ID транзакции: \`${txnId}\``,
    newWithdrawal: (user, amount, bookmaker, accountId, code, txnId) =>
      `🆕 *НОВЫЙ ВЫВОД*\n\n` +
      `👤 Пользователь: ${user}\n` +
      `💰 Сумма: *${amount} сом*\n` +
      `🏦 Букмекер: ${bookmaker}\n` +
      `🆔 Аккаунт: ${accountId}\n` +
      `🔑 Код: ${code}\n` +
      `📋 ID транзакции: \`${txnId}\``,
  },
};