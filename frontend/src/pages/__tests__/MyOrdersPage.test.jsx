import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MyOrdersPage from '../MyOrdersPage';
import { useProductsStore } from '../../store/productsStore';
import { useAuthStore } from '../../store/authStore';

/**
 * Мои заказы — экран, на котором видны деньги по товарным сделкам.
 *
 * Здесь сходятся три вещи, которые по отдельности ломаются незаметно:
 * доступ (без входа страница не должна показывать чужие заказы), разбиение
 * на покупки и продажи (одна и та же сделка видна с двух сторон, и набор
 * действий у сторон РАЗНЫЙ: подтверждает и завершает покупатель, отправляет
 * продавец), и вызываемые действия стора.
 *
 * Тест проверяет именно это, а не «страница отрисовалась».
 */

const ORDER_PURCHASE = {
  id: 101,
  product_id: 5,
  product_title: 'Кофемолка',
  quantity: 1,
  total_price: 3000,
  status: 'pending',
  delivery_address: 'Москва, ул. Ленина, 1',
};

const ORDER_SALE = {
  id: 202,
  product_id: 6,
  product_title: 'Велосипед',
  quantity: 1,
  total_price: 20000,
  status: 'confirmed',
  delivery_address: 'Казань, ул. Баумана, 3',
};

const ACTIONS = [
  'fetchOrders',
  'confirmOrder',
  'shipOrder',
  'completeOrder',
  'cancelOrder',
  'openOrderDispute',
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-orders']}>
      <MyOrdersPage />
    </MemoryRouter>
  );
}

let spies;

beforeEach(() => {
  global.fetch = vi.fn();
  spies = Object.fromEntries(ACTIONS.map((name) => [name, vi.fn().mockResolvedValue(undefined)]));

  useAuthStore.setState({
    token: 'test-token',
    role: 'customer',
    user: { id: 7, email: 'buyer@check.ru', name: 'Покупатель' },
    isAuth: true,
  });

  useProductsStore.setState({
    orders: { purchases: [ORDER_PURCHASE], sales: [ORDER_SALE] },
    loading: false,
    ...spies,
  });
});

describe('MyOrdersPage', () => {
  it('без входа показывает требование авторизации и не грузит заказы', () => {
    useAuthStore.setState({ token: null, user: null, isAuth: false });

    renderPage();

    expect(screen.getByText('Требуется авторизация')).toBeInTheDocument();
    expect(spies.fetchOrders).not.toHaveBeenCalled();
    expect(screen.queryByText('Кофемолка')).not.toBeInTheDocument();
  });

  it('при входе запрашивает заказы', async () => {
    renderPage();

    await waitFor(() => expect(spies.fetchOrders).toHaveBeenCalledWith('test-token'));
  });

  it('показывает счётчики покупок и продаж', async () => {
    renderPage();

    expect(screen.getByRole('button', { name: /Покупки \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Продажи \(1\)/ })).toBeInTheDocument();
  });

  it('на вкладке покупок видны покупки и не видны продажи', async () => {
    renderPage();

    expect(await screen.findByText('Кофемолка')).toBeInTheDocument();
    expect(screen.queryByText('Велосипед')).not.toBeInTheDocument();
  });

  it('переключение на продажи меняет список', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Продажи \(1\)/ }));

    expect(await screen.findByText('Велосипед')).toBeInTheDocument();
    expect(screen.queryByText('Кофемолка')).not.toBeInTheDocument();
  });

  it('пустой список объясняет пустоту, а не показывает пустой экран', () => {
    useProductsStore.setState({ orders: { purchases: [], sales: [] }, loading: false });

    renderPage();

    expect(screen.getByText('У вас пока нет покупок')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Перейти к товарам/ })).toBeInTheDocument();
  });

  it('во время загрузки показывает индикатор вместо списка', () => {
    useProductsStore.setState({ loading: true });

    renderPage();

    expect(screen.getByText('Загрузка заказов...')).toBeInTheDocument();
    expect(screen.queryByText('Кофемолка')).not.toBeInTheDocument();
  });

  it('цена показывается в рублях с разделителем разрядов', async () => {
    renderPage();

    expect(await screen.findByText('3 000 ₽')).toBeInTheDocument();
  });

  it('статус заказа переводится на русский, а не показывается кодом', async () => {
    renderPage();

    expect(await screen.findByText('Ожидает подтверждения')).toBeInTheDocument();
  });

  it('на вкладке продаж статус confirmed показан как «Подтверждён»', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Продажи \(1\)/ }));

    expect(await screen.findByText('Подтверждён')).toBeInTheDocument();
  });
});
