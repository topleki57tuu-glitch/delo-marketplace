import React, { useState, useEffect } from 'react';
import { useToast } from './Toast';
import { format, isToday, isYesterday } from 'date-fns';
import { ru } from 'date-fns/locale';

const TX_TYPE_NAMES = {
  deposit: '💰 Пополнение',
  escrow_hold: '🔒 Заморозка (эскроу)',
  escrow_release: '💸 Выплата (эскроу)',
  escrow_refund: '↩ Возврат (эскроу)',
  purchase: '🛒 Покупка пакета',
  withdraw_hold: '🏦 Вывод средств (заявка)',
  withdraw_refund: '↩ Возврат заявки на вывод',
};

function formatTransactionDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);

  if (isToday(date)) {
    return 'Сегодня, ' + format(date, 'HH:mm');
  } else if (isYesterday(date)) {
    return 'Вчера, ' + format(date, 'HH:mm');
  } else {
    return format(date, 'd MMMM yyyy, HH:mm', { locale: ru });
  }
}

/**
 * Компонент истории транзакций с поиском и фильтрацией
 */
export function TransactionsHistory({ token }) {
  const { addToast } = useToast();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');

  useEffect(() => {
    loadTransactions();
  }, [token]);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/wallet/transactions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (err) {
      addToast('Не удалось загрузить транзакции', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCsv = async () => {
    try {
      const res = await fetch('/wallet/transactions.csv', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Не удалось скачать отчёт');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'delo_transactions.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Фильтрация транзакций
  const filteredTransactions = transactions.filter(tx => {
    // Фильтр по типу
    if (filterType !== 'all' && tx.type !== filterType) return false;

    // Поиск по типу или сумме
    if (searchQuery) {
      const typeName = TX_TYPE_NAMES[tx.type] || tx.type;
      const query = searchQuery.toLowerCase();
      if (!typeName.toLowerCase().includes(query) &&
          !tx.amount.toString().includes(query)) {
        return false;
      }
    }

    return true;
  });

  // Группировка по датам
  const groupedTransactions = filteredTransactions.reduce((groups, tx) => {
    const date = new Date(tx.created_at);
    let dateKey;

    if (isToday(date)) {
      dateKey = 'Сегодня';
    } else if (isYesterday(date)) {
      dateKey = 'Вчера';
    } else {
      dateKey = format(date, 'd MMMM yyyy', { locale: ru });
    }

    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(tx);
    return groups;
  }, {});

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">История операций</h3>
        <button
          onClick={handleDownloadCsv}
          className="px-3 py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors"
        >
          📥 Скачать CSV
        </button>
      </div>

      {/* Поиск и фильтры */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Поиск по операциям..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              filterType === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            Все
          </button>
          <button
            onClick={() => setFilterType('deposit')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              filterType === 'deposit'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            💰 Пополнения
          </button>
          <button
            onClick={() => setFilterType('escrow_release')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              filterType === 'escrow_release'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            💸 Выплаты
          </button>
          <button
            onClick={() => setFilterType('withdraw_hold')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              filterType === 'withdraw_hold'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            🏦 Выводы
          </button>
        </div>
      </div>

      {/* Список транзакций */}
      <div className="space-y-4 max-h-96 overflow-y-auto">
        {loading ? (
          <div className="py-8 text-center text-slate-400 text-sm">Загрузка...</div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">
            {searchQuery || filterType !== 'all' ? 'Ничего не найдено' : 'Нет операций'}
          </div>
        ) : (
          Object.entries(groupedTransactions).map(([dateKey, txs]) => (
            <div key={dateKey} className="space-y-2">
              <div className="sticky top-0 bg-white dark:bg-slate-800 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                {dateKey}
              </div>
              {txs.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors"
                >
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {TX_TYPE_NAMES[tx.type] || tx.type}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {format(new Date(tx.created_at), 'HH:mm')}
                      {tx.task_id && ` • Заказ #${tx.task_id}`}
                    </div>
                  </div>
                  <div className={`text-sm font-bold ${
                    tx.amount > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString('ru-RU')} ₽
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
