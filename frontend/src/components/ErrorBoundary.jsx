import React from 'react';

/**
 * ErrorBoundary - ловит ошибки React и предотвращает белый экран.
 *
 * Использование:
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 *
 * При ошибке показывает fallback UI вместо краша приложения.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Обновляем state чтобы следующий рендер показал fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Логируем ошибку
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // TODO: отправить в Sentry если настроен
    // if (window.Sentry) {
    //   window.Sentry.captureException(error, { contexts: { react: errorInfo } });
    // }

    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 text-center border border-slate-200 dark:border-slate-700 shadow-xl">
            {/* Icon */}
            <div className="text-6xl mb-4" role="img" aria-label="Ошибка">
              ⚠️
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Что-то пошло не так
            </h1>

            {/* Description */}
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Произошла ошибка при отображении страницы. Пожалуйста, обновите страницу или вернитесь назад.
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={this.handleReload}
                className="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors"
              >
                Обновить страницу
              </button>
              <button
                onClick={this.handleReset}
                className="w-full px-6 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-semibold rounded-xl transition-colors"
              >
                Попробовать снова
              </button>
            </div>

            {/* Error details (только в development) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
                  Детали ошибки (dev mode)
                </summary>
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <pre className="text-xs text-red-800 dark:text-red-300 overflow-auto whitespace-pre-wrap break-words">
                    {this.state.error.toString()}
                    {this.state.errorInfo && (
                      <>
                        {'\n\nComponent Stack:'}
                        {this.state.errorInfo.componentStack}
                      </>
                    )}
                  </pre>
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Хук для programmatic error throwing (для тестирования Error Boundary).
 */
export function useErrorHandler() {
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return setError;
}
