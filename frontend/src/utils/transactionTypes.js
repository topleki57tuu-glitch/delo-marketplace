/**
 * Русские названия типов транзакций.
 *
 * Ключи — значения TransactionType из backend/app/models/__init__.py.
 * Формулировки совпадают с теми, что видит пользователь в истории операций
 * (ProfileTransactions.jsx / ProfilePage.jsx), чтобы тип читался одинаково.
 *
 * Зачем отдельный модуль. Те же строки уже продублированы в двух местах —
 * в ProfileTransactions.jsx и ProfilePage.jsx, причём там они хранятся вместе
 * с иконками (элементами React), а админ-панели нужен только текст. В
 * AdminDashboardPage стоял `tr.type.replace('_', ' ')`, поэтому в русском
 * интерфейсе печаталось «Escrow hold» и «Withdraw refund».
 *
 * Иконки сюда не переезжают намеренно: это разметка, и держать её в utils
 * неправильно. Объединять оба словаря в один — отдельная задача.
 */
export const TRANSACTION_TYPE_LABELS = {
    deposit: 'Пополнение',
    escrow_hold: 'Заморозка (эскроу)',
    escrow_release: 'Выплата (эскроу)',
    escrow_refund: 'Возврат (эскроу)',
    purchase: 'Покупка пакета',
    withdraw_hold: 'Вывод средств (заявка)',
    withdraw_refund: 'Возврат заявки на вывод',
};

/** Подпись типа транзакции. Неизвестный ключ возвращаем как есть. */
export const transactionTypeLabel = (key) =>
    TRANSACTION_TYPE_LABELS[key] || String(key).replace(/_/g, ' ');
