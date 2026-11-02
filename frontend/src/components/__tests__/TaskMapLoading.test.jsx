import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../Toast';
import { TaskMap } from '../TaskMap.jsx';
import { loadYmaps, resetYmapsLoader } from '../taskMap/loadYmaps.js';

/**
 * Загрузка Яндекс Карт. Раньше компонент ловил только ошибку загрузки
 * самого скрипта: если не загружались модули API (их блокировала политика
 * безопасности сайта), ymaps.ready не наступал и «Загрузка интерактивной
 * карты…» крутилась бесконечно, а «Повторить» не мог помочь.
 */

const LOADING = 'Загрузка интерактивной карты...';
const script = () => document.getElementById('ymaps-script');

function fakeYmaps() {
  const geoObjects = { add: vi.fn(), remove: vi.fn() };
  return {
    ready: (ok) => ok(),
    Map: vi.fn(function Map() {
      return { geoObjects, behaviors: { enable: vi.fn() }, destroy: vi.fn(), setCenter: vi.fn(), getZoom: () => 11, setBounds: vi.fn() };
    }),
    Clusterer: vi.fn(function Clusterer() {
      return { add: vi.fn(), removeAll: vi.fn(), getBounds: () => null };
    }),
    Placemark: vi.fn(function Placemark() {
      return { events: { add: vi.fn() } };
    }),
  };
}

function renderMap() {
  return render(
    <ToastProvider>
      <TaskMap tasks={[]} />
    </ToastProvider>
  );
}

beforeEach(() => {
  resetYmapsLoader();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('TaskMap: загрузка Яндекс Карт', () => {
  it('модули API не загрузились — сообщение вместо бесконечной загрузки', async () => {
    renderMap();
    expect(screen.getByText(LOADING)).toBeInTheDocument();

    // Скрипт загрузился, но ymaps.ready сообщает об ошибке (модули заблокированы).
    window.ymaps = { ready: (_ok, fail) => fail(new Event('error')) };
    script().onload();

    expect(await screen.findByText(/Не удалось загрузить карту/)).toBeInTheDocument();
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('«Повторить» загружает API заново и показывает карту', async () => {
    const user = userEvent.setup();
    renderMap();
    script().onerror();
    await screen.findByText(/Не удалось загрузить карту/);
    expect(script()).toBeNull(); // неудачный скрипт убран, чтобы не мешал новой попытке

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    window.ymaps = fakeYmaps();
    script().onload();

    await waitFor(() => expect(screen.queryByText(LOADING)).not.toBeInTheDocument());
    expect(window.ymaps.Map).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Не удалось загрузить карту/)).not.toBeInTheDocument();
  });
});

describe('loadYmaps', () => {
  it('тайм-аут отклоняет загрузку', async () => {
    await expect(loadYmaps({ timeoutMs: 20 })).rejects.toThrow('не ответило вовремя');
    expect(script()).toBeNull();
  });

  it('скрипт без API после загрузки — ошибка, а не вечное ожидание', async () => {
    const p = loadYmaps();
    script().onload();
    await expect(p).rejects.toThrow('API не появилось');
  });

  it('удачная загрузка запоминается: второй вызов не добавляет скрипт', async () => {
    const p = loadYmaps();
    window.ymaps = fakeYmaps();
    script().onload();
    await expect(p).resolves.toBe(window.ymaps);

    const appendSpy = vi.spyOn(document.head, 'appendChild');
    await expect(loadYmaps()).resolves.toBe(window.ymaps);
    expect(appendSpy).not.toHaveBeenCalled();
  });
});
