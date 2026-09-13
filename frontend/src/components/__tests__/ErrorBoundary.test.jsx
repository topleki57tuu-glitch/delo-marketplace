import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// Компонент который выбрасывает ошибку
function ThrowError() {
  throw new Error('Test error');
}

// Обычный компонент
function NoError() {
  return <div>Working component</div>;
}

describe('ErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <ErrorBoundary>
        <NoError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Working component')).toBeInTheDocument();
  });

  it('should catch error and show fallback UI', () => {
    // Подавляем console.error в тесте
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByText(/Произошла ошибка при отображении страницы/i)).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should show reload button', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const reloadButton = screen.getByRole('button', { name: /обновить страницу/i });
    expect(reloadButton).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should show back button', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const backButton = screen.getByRole('button', { name: /назад/i });
    expect(backButton).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('should show error details in development mode', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Детали ошибки/i)).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
    consoleSpy.mockRestore();
  });
});
