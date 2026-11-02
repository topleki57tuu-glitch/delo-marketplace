/**
 * Русские названия типов транзакций — единый словарь для истории операций
 * в личном кабинете (pages/profile/profileShared.jsx добавляет к ним иконки)
 * и для админ-панели (AdminDashboardPage).
 *
 * Ключи — значения TransactionType из backend/app/models/__init__.py.
 * Иконки сюда не переезжают намеренно: это разметка, и держать её в utils
 * неправильно. Раньше словарей было два, и формулировки разошлись:
 * пользователь видел «Заморозка по сделке», а админ-панель — «Заморозка (эскроу)».
 */
export const TRANSACTION_TYPE_LABELS = {
    deposit: 'Пополнение',
    escrow_hold: 'Заморозка по сделке',
    escrow_release: 'Выплата по сделке',
    escrow_refund: 'Возврат по сделке',
    purchase: 'Покупка пакета',
    withdraw_hold: 'Вывод средств (заявка)',
    withdraw_refund: 'Возврат заявки на вывод',
};

/** Подпись типа транзакции. Неизвестный ключ возвращаем как есть. */
export const transactionTypeLabel = (key) =>
    TRANSACTION_TYPE_LABELS[key] || String(key).replace(/_/g, ' ');
