// Состояние личного кабинета, которое живёт на уровне страницы, а не
// внутри вкладки: черновики анкеты и смены пароля не теряются, если по ходу
// заглянуть в кошелёк и вернуться, а проверку зависших платежей запускают
// и возврат с оплаты, и кнопка во вкладке «Кошелёк».
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { parseList } from '../../utils/format.js';
import { useAuthStore } from '../../store/authStore';
import { apiErrorMessage } from '../../utils/apiError';

const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

// Разбор ошибки от бэкенда. Pydantic на неверный пароль отдаёт не строку,
// а список объектов; при наивном new Error(data.detail) пользователь увидел
// бы «[object Object]» вместо причины отказа.
const readApiError = (data, fallback) => {
  const detail = data && data.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    if (typeof first === 'string') return first;
    if (first && typeof first.msg === 'string') {
      return first.msg.replace(/^Value error,\s*/, '');
    }
  }
  return fallback;
};

// Анкета: поля формы редактирования и её сохранение.
export function useProfileForm({ user, token, onUpdateUser }) {
  const { addToast } = useToast();
  const isSpecialist = user?.role === 'specialist';
  const auth = authHeaders(token);

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [city, setCity] = useState(user?.city || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [skills, setSkills] = useState(parseList(user?.skills).join(', '));
  const [saving, setSaving] = useState(false);

  // Поля формы подтягиваем, когда профиль догрузился или обновился
  useEffect(() => {
    if (!user || isEditing) return;
    setName(user.name || '');
    setBio(user.bio || '');
    setCity(user.city || '');
    setPhone(user.phone || '');
    setSkills(parseList(user.skills).join(', '));
  }, [user, isEditing]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || null,
        bio: bio.trim(),
        city: (typeof city === 'object' && city ? city.name : city || '').trim(),
        phone: phone.trim(),
      };
      if (isSpecialist) {
        payload.skills = JSON.stringify(parseList(skills).slice(0, 20));
      }
      const res = await fetch('/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Не удалось обновить профиль');

      addToast('Профиль обновлён', 'success');
      setIsEditing(false);
      onUpdateUser();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return {
    isEditing, setIsEditing,
    name, setName,
    bio, setBio,
    city, setCity,
    phone, setPhone,
    skills, setSkills,
    saving,
    handleSaveProfile,
  };
}

export function usePasswordForm({ token }) {
  const { addToast } = useToast();
  const auth = authHeaders(token);

  // Смена пароля — отдельная форма со своим запросом: Enter в поле пароля
  // не должен отправлять сохранение профиля.
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwRepeat, setPwRepeat] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();

    // Проверки ниже повторяют серверные, но не заменяют их: они экономят
    // запрос, а решение всё равно принимает бэкенд (app/schemas/_check_password).
    if (pwNew !== pwRepeat) {
      addToast('Новый пароль и повтор не совпадают', 'error');
      return;
    }
    if (pwNew.length < 8) {
      addToast('Новый пароль короче 8 символов', 'error');
      return;
    }
    if (!/\d/.test(pwNew)) {
      addToast('В новом пароле нужна хотя бы одна цифра', 'error');
      return;
    }

    setPwSaving(true);
    try {
      const res = await fetch('/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(readApiError(data, 'Не удалось сменить пароль'));

      setPwCurrent('');
      setPwNew('');
      setPwRepeat('');
      // Бэкенд закрыл все сессии и выдал этой вкладке новую пару токенов:
      // здесь вход продолжается, на других устройствах нужно войти заново.
      if (data.refresh_token) {
        const { login, role: currentRole } = useAuthStore.getState();
        login(data.access_token || token, currentRole, data.refresh_token);
      }
      addToast('Пароль изменён', 'success');
      addToast('На других устройствах нужно войти заново', 'info');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setPwSaving(false);
    }
  };

  return { pwCurrent, setPwCurrent, pwNew, setPwNew, pwRepeat, setPwRepeat, pwSaving, handleChangePassword };
}

export function usePendingPayments({ token, onUpdateUser }) {
  const { addToast } = useToast();
  const [, setSearchParams] = useSearchParams();
  const [checkingPayments, setCheckingPayments] = useState(false);

  // Дозачисление «зависших» платежей. Зачисление держится на вебхуке —
  // он настраивается в кабинете провайдера отдельно от кода, и пока там
  // указан старый домен, уведомления не приходят вообще, — и на возврате
  // плательщика в браузере. Оба пути могут отказать молча, поэтому есть
  // отдельный вызов: он спрашивает провайдера про НАШИ незачисленные
  // платежи и зачисляет те, что оплачены. Сервер ничего не берёт из
  // запроса, так что перебрать чужие платежи этим вызовом нельзя.
  const checkPendingPayments = useCallback(async ({ quiet = false } = {}) => {
    if (!token) return;
    setCheckingPayments(true);
    try {
      const res = await fetch('/payments/confirm-pending', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (!quiet) addToast(apiErrorMessage(data, 'Не удалось проверить платежи'), 'error');
        return;
      }

      if (data.credited?.length) {
        addToast(`Баланс пополнен на ${data.total.toLocaleString('ru-RU')} ₽!`, 'success');
        if (onUpdateUser) onUpdateUser();
      } else if (!quiet) {
        // «Проверено, но не оплачено» и «нечего проверять» — разные ответы:
        // в первом случае стоит подождать, во втором ждать нечего.
        addToast(
          data.checked
            ? 'Оплата пока не подтверждена провайдером. Попробуйте через минуту.'
            : 'Незавершённых платежей нет.',
          'info'
        );
      }
    } catch {
      if (!quiet) addToast('Не удалось проверить платежи', 'error');
    } finally {
      setCheckingPayments(false);
    }
  }, [token, addToast, onUpdateUser]);

  // Возврат из ЮMoney после оплаты (successURL в платёжной форме ведёт сюда
  // с параметром `payment=return`). Само по себе возвращение денег не
  // зачисляет: вебхук может ещё не прийти, а зачисление — отдельный шаг.
  //
  // Раньше здесь читался `delo_pending_payment` из `sessionStorage`, и без
  // него подтверждение молча пропускалось. На iOS форма оплаты открывается
  // отдельной вкладкой, и хранилище сеанса туда не доезжает — платёж
  // оставался неоплаченным с точки зрения приложения навсегда, потому что
  // восстановить его из интерфейса было нечем.
  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') !== 'return') return;

    // Параметр из адреса убираем сразу: проверка должна сработать один раз,
    // а не при каждом обновлении страницы или возврате по «назад».
    // Вместо него открываем вкладку кошелька — там видно результат.
    params.delete('payment');
    params.set('tab', 'wallet');
    setSearchParams(params, { replace: true });

    checkPendingPayments();
  }, [token, checkPendingPayments]);

  return { checkingPayments, checkPendingPayments };
}
