import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TasksPage from '../TasksPage';

/**
 * Лента заданий — главная точка входа для исполнителя.
 *
 * Страница берёт данные пропсами, поэтому проверять её можно без моков сети:
 * важно ровно то, что происходит с фильтрами и что видит пользователь.
 *
 * Фильтрация здесь — не украшение: категория живёт в адресе (`?category=`),
 * поиск и город — в состоянии. Ошибка в любом из них даёт «Ничего не найдено»
 * на непустом списке, а это выглядит как «заказов нет», а не как дефект.
 */

const TASKS = [
  {
    id: 1,
    title: 'Собрать шкаф',
    description: 'Нужно собрать шкаф-купе',
    category: 'repairs',
    city: 'Москва',
    is_remote: false,
    budget: 5000,
  },
  {
    id: 2,
    title: 'Сверстать лендинг',
    description: 'React и Tailwind',
    category: 'development',
    city: null,
    is_remote: true,
    budget: 40000,
  },
  {
    id: 3,
    title: 'Написать тексты',
    description: 'Статьи для блога',
    category: 'writing',
    city: 'Казань',
    is_remote: false,
    budget: null,
  },
];

function renderPage(props = {}, url = '/tasks') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <TasksPage tasks={TASKS} {...props} />
    </MemoryRouter>
  );
}

describe('TasksPage', () => {
  it('показывает все задания и их количество', () => {
    renderPage();

    expect(screen.getByText('Собрать шкаф')).toBeInTheDocument();
    expect(screen.getByText('Сверстать лендинг')).toBeInTheDocument();
    expect(screen.getByText('Написать тексты')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('категория из адреса фильтрует список', () => {
    renderPage({}, '/tasks?category=development');

    expect(screen.getByText('Сверстать лендинг')).toBeInTheDocument();
    expect(screen.queryByText('Собрать шкаф')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('поиск фильтрует по названию и описанию', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/Поиск по названию или описанию/), 'статьи');

    // Совпадение по описанию, а не по названию — так проверяется, что
    // ищется и в description тоже.
    expect(screen.getByText('Написать тексты')).toBeInTheDocument();
    expect(screen.queryByText('Собрать шкаф')).not.toBeInTheDocument();
    expect(screen.queryByText('Сверстать лендинг')).not.toBeInTheDocument();
  });

  it('пустой результат показывает подсказку, а не пустой экран', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/Поиск по названию или описанию/), 'нетакогозадания');

    const emptyState = screen.getByText('Ничего не найдено').closest('div');
    expect(emptyState).not.toBeNull();
    expect(within(emptyState).getByRole('button', { name: /Сбросить фильтры/ })).toBeInTheDocument();
  });

  it('«Сбросить фильтры» возвращает список целиком', async () => {
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByPlaceholderText(/Поиск по названию или описанию/);
    await user.type(search, 'нетакогозадания');

    // Кнопок с этой подписью две: одна в панели фильтров, вторая — в блоке
    // «ничего не найдено». Проверяем ту, что в блоке, иначе тест зависит от
    // порядка кнопок на странице.
    const emptyState = screen.getByText('Ничего не найдено').closest('div');
    await user.click(within(emptyState).getByRole('button', { name: /Сбросить фильтры/ }));

    expect(screen.getByText('Собрать шкаф')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('пустой список заданий не ломает страницу', () => {
    renderPage({ tasks: [] });

    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('во время загрузки показывает индикатор вместо списка', () => {
    renderPage({ loading: true });

    expect(screen.getByText('Загрузка заданий...')).toBeInTheDocument();
    expect(screen.queryByText('Собрать шкаф')).not.toBeInTheDocument();
  });

  it('нажатие на задание отдаёт его наружу целиком', async () => {
    const user = userEvent.setup();
    const onTaskClick = vi.fn();
    renderPage({ onTaskClick });

    await user.click(screen.getByText('Собрать шкаф'));

    expect(onTaskClick).toHaveBeenCalledTimes(1);
    expect(onTaskClick.mock.calls[0][0]).toMatchObject({ id: 1, title: 'Собрать шкаф' });
  });

  it('бюджет показывается в рублях, а его отсутствие — словами', () => {
    renderPage();

    expect(screen.getByText('40 000 ₽')).toBeInTheDocument();
    expect(screen.getByText('По договоренности')).toBeInTheDocument();
  });
});
