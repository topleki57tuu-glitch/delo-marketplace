// Вкладка «Настройки» личного кабинета: Telegram, смена пароля, тема
// оформления и выход. Состояние формы пароля приходит из страницы
// (usePasswordForm).
import React from 'react';
import { ThemeSwitch } from '../../components/ThemeToggle.jsx';
import { IconLock, IconLogout } from '../../components/icons.jsx';
import { Panel } from './profileShared.jsx';
import TelegramPanel from './TelegramPanel.jsx';

export default function SettingsTab({ user, token, passwordForm, onLogout }) {
  const { pwCurrent, setPwCurrent, pwNew, setPwNew, pwRepeat, setPwRepeat, pwSaving, handleChangePassword } = passwordForm;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
      <div className="space-y-5 min-w-0">
        <TelegramPanel token={token} />
        <Panel
          eyebrow="Безопасность"
          title="Смена пароля"
          text="После смены пароля на других устройствах нужно будет войти заново."
        >
          <form onSubmit={handleChangePassword} className="space-y-4">
            <input type="text" name="username" autoComplete="username" value={user.email || ''} readOnly hidden />
            <div>
              <label htmlFor="pw-current" className="field-label">Текущий пароль</label>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                required
                className="input"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="pw-new" className="field-label">Новый пароль</label>
                <input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  required
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="pw-repeat" className="field-label">Повторите новый пароль</label>
                <input
                  id="pw-repeat"
                  type="password"
                  autoComplete="new-password"
                  value={pwRepeat}
                  onChange={(e) => setPwRepeat(e.target.value)}
                  required
                  className="input"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Не меньше 8 символов и хотя бы одна цифра.</p>
              <button type="submit" disabled={pwSaving} className="btn btn-primary">
                <IconLock size={16} /> {pwSaving ? 'Меняем...' : 'Сменить пароль'}
              </button>
            </div>
          </form>
        </Panel>
      </div>

      <aside className="space-y-5">
        <Panel eyebrow="Оформление" title="Тема">
          <ThemeSwitch className="w-full" />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">«Авто» — как в настройках устройства.</p>
        </Panel>
        <Panel eyebrow="Аккаунт" title="Выход">
          <p className="text-sm text-slate-500 dark:text-slate-400 break-all">{user.email}</p>
          <button type="button" onClick={onLogout} className="btn btn-secondary w-full mt-4 !text-red-600 dark:!text-red-400">
            <IconLogout size={16} /> Выйти из аккаунта
          </button>
        </Panel>
      </aside>
    </div>
  );
}
