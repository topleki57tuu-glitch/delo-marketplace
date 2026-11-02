import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import HomePage from '../HomePage';
import { STAGES } from '../home/EscrowDemo.jsx';
import { POLL_MS } from '../home/FreshTasks.jsx';

/**
 * Главная с анимациями. Проверяем не «красоту», а то, что движение ничего
 * не ломает: текст виден без IntersectionObserver, при «уменьшить движение»
 * всё стоит на месте, пример сделки ставится на паузу, FAQ открывается
 * и закрывается, а живая лента не теряет задания и метит новые.
 */

const NOW = new Date('2026-11-02T12:00:00Z');

/** Сервер отдаёт created_at в UTC без зоны — так и мокаем. */
function task(id, minutesAgo) {
  return {
    id,
    title: `Задание ${id}`,
    description: 'Описание задания',
    category: 'repairs',
    city: 'Москва',
    is_remote: false,
    budget: 1000 * id,
    status: 'open',
    created_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString().replace('Z', ''),
  };
}

/** Каждый следующий запрос получает следующий список, последний повторяется. */
function mockTasks(...lists) {
  let call = 0;
  fetch.mockImplementation(() => {
    const list = lists[Math.min(call, lists.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ tasks: list }) });
  });
}

function setReducedMotion() {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderHome({ user = null, onOpenAuth = vi.fn() } = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage user={user} onOpenAuth={onOpenAuth} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const searchInput = () => screen.getByRole('textbox', { name: 'Что нужно сделать?' });
const dealCard = () => screen.getByRole('figure', { name: /безопасная сделка/i });
const advance = (ms) => act(() => vi.advanceTimersByTime(ms));

afterEach(() => {
  vi.restoreAllMocks();
  delete window.matchMedia;
  delete HTMLElement.prototype.animate;
  vi.useRealTimers();
});

describe('HomePage', () => {
  it('без IntersectionObserver всё содержимое сразу видно — анимация не прячет текст', async () => {
    mockTasks([task(1, 5)]);
    const { container } = renderHome();
    await act(async () => {});

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Найдите специалиста для любой задачи');
    for (const title of [
      'Чем можем помочь',
      'Свежие задания',
      'Четыре шага до результата',
      'Деньги защищены на каждом этапе',
      'Зарабатывайте на своих навыках',
      'Частые вопросы',
      'Опишите задачу — остальное возьмём на себя',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    const blocks = container.querySelectorAll('[data-reveal]');
    expect(blocks.length).toBeGreaterThan(10);
    blocks.forEach((el) => expect(el).toHaveAttribute('data-inview'));
  });

  it('подсказка в поиске печатает примеры и замирает целым примером, когда поле в фокусе', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // скорость «набора» — без случайности
    mockTasks([]);
    renderHome();
    await act(async () => {});
    expect(searchInput()).toHaveAttribute('placeholder', 'Например, собрать шкаф');

    advance(2600); // пауза, затем стёрт первый пример
    expect(searchInput()).toHaveAttribute('placeholder', 'Например, ');
    advance(3400); // второй пример набран и держится
    expect(searchInput()).toHaveAttribute('placeholder', 'Например, нарисовать логотип');

    advance(700); // начал стирать: «Например, нарисоват»
    expect(searchInput().getAttribute('placeholder').length).toBeLessThan('Например, нарисовать логотип'.length);
    act(() => searchInput().focus());
    expect(searchInput()).toHaveAttribute('placeholder', 'Например, нарисовать логотип');
    advance(20_000);
    expect(searchInput()).toHaveAttribute('placeholder', 'Например, нарисовать логотип');
  });

  it('при «уменьшить движение» всё статично: подсказка не меняется, сделка стоит на эскроу', async () => {
    setReducedMotion();
    vi.useFakeTimers();
    mockTasks([]);
    renderHome();
    await act(async () => {});

    advance(20_000);
    expect(searchInput()).toHaveAttribute('placeholder', 'Например, собрать шкаф');
    const card = dealCard();
    expect(within(card).getByText('Ремонт ванной комнаты')).toBeInTheDocument();
    expect(within(card).getByText('Заморожено')).toBeInTheDocument();
    expect(card).toHaveTextContent(/45\s000\s₽/);
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('пример сделки проходит шаги, встаёт на паузу по кнопке и переходит к следующей сделке', async () => {
    vi.useFakeTimers();
    mockTasks([]);
    renderHome();
    await act(async () => {});
    const card = dealCard();
    expect(within(card).getByText('Бюджет задания')).toBeInTheDocument();

    // Таймер следующего кадра ставится после рендера — идём по кадру за раз.
    STAGES.slice(0, 3).forEach((s) => advance(s.ms));
    expect(within(card).getByText('Заморожено')).toBeInTheDocument();
    STAGES.slice(3, 5).forEach((s) => advance(s.ms));
    expect(within(card).getByText('Выплачено исполнителю')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Остановить пример' }));
    advance(30_000);
    expect(within(card).getByText('Выплачено исполнителю')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Продолжить пример' }));
    STAGES.slice(5).forEach((s) => advance(s.ms));
    expect(within(card).getByText('Логотип для кофейни')).toBeInTheDocument();
    expect(within(card).getByText('Бюджет задания')).toBeInTheDocument();
  });

  it('FAQ: без Web Animations API — обычный <details>, с ним — плавно и с разворотом', async () => {
    mockTasks([]);
    renderHome();
    await act(async () => {});
    const summary = screen.getByText('Как пополнить баланс?');
    const details = summary.closest('details');
    expect(details.open).toBe(false);

    const animations = [];
    HTMLElement.prototype.animate = vi.fn(() => {
      const animation = { cancel: vi.fn(), onfinish: null };
      animations.push(animation);
      return animation;
    });

    fireEvent.click(summary); // открываем
    expect(details.open).toBe(true);
    act(() => animations.at(-1).onfinish());
    expect(details.style.height).toBe('');

    fireEvent.click(summary); // закрываем: плюсик поворачивается сразу
    expect(details).toHaveClass('is-closing');
    expect(details.open).toBe(true);
    const closing = animations.at(-1);
    fireEvent.click(summary); // передумали посреди анимации
    expect(details).not.toHaveClass('is-closing');
    expect(closing.cancel).toHaveBeenCalled();
    expect(details.open).toBe(true);

    fireEvent.click(summary);
    act(() => animations.at(-1).onfinish());
    expect(details.open).toBe(false);
    expect(details).not.toHaveClass('is-closing');
  });

  it('свежие задания: подпись времени, метка «только что» и новое задание при обновлении', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockTasks([task(1, 1), task(2, 180)], [task(3, 0), task(1, 1), task(2, 180)]);
    renderHome();
    await act(async () => {});

    const first = screen.getByText('Задание 1').closest('a');
    expect(within(first).getByText('только что')).toBeInTheDocument();
    expect(within(screen.getByText('Задание 2').closest('a')).getByText('3 часа назад')).toBeInTheDocument();
    expect(screen.queryByText('Задание 3')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const arrived = screen.getByText('Задание 3').closest('a');
    expect(arrived).toHaveClass('home-task-new');
    expect(within(arrived).getByText('только что')).toBeInTheDocument();
    expect(first).not.toHaveClass('home-task-new');
  });

  it('ошибка обновления не стирает уже показанные задания', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockTasks([task(1, 30)]);
    renderHome();
    await act(async () => {});
    expect(screen.getByText('Задание 1')).toBeInTheDocument();

    fetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(screen.getByText('Задание 1')).toBeInTheDocument();
  });

  it('вкладки «Заказчикам / Исполнителям» переключают шаги', async () => {
    mockTasks([]);
    renderHome();
    await act(async () => {});
    fireEvent.click(screen.getByRole('tab', { name: 'Исполнителям' }));
    expect(screen.getByRole('tab', { name: 'Исполнителям' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Заполните профиль')).toBeInTheDocument();
    expect(screen.queryByText('Опишите задачу')).toBeNull();
  });

  it('поиск ведёт к созданию задания с текстом, гостю предлагает регистрацию', async () => {
    mockTasks([]);
    const onOpenAuth = vi.fn();
    const { unmount } = renderHome({ onOpenAuth });
    await act(async () => {});
    fireEvent.change(searchInput(), { target: { value: 'Повесить полку' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Создать задание' })[0]);
    expect(onOpenAuth).toHaveBeenCalledWith('register');
    unmount();

    renderHome({ user: { id: 1 } });
    await act(async () => {});
    fireEvent.change(searchInput(), { target: { value: 'Повесить полку' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Создать задание' })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent('/create-task?title=%D0%9F%D0%BE%D0%B2%D0%B5%D1%81%D0%B8%D1%82%D1%8C%20%D0%BF%D0%BE%D0%BB%D0%BA%D1%83');
  });
});
