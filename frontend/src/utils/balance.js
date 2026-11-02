// Актуальный баланс перед денежным действием.
//
// Баланс в шапке обновляется опросом профиля и может отставать: например,
// пользователь только что пополнил счёт в соседней вкладке. Проверять
// «хватит ли денег» по устаревшему числу нельзя — человек увидел бы
// «не хватает» сразу после пополнения. Поэтому перед отказом спрашиваем
// сервер; при ошибке сети возвращаем то, что знали.
export async function fetchFreshBalance(token, fallback) {
  if (!token) return fallback;
  try {
    const res = await fetch('/users/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return fallback;
    const me = await res.json();
    return typeof me?.balance === 'number' ? me.balance : fallback;
  } catch {
    return fallback;
  }
}
