import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });

    // TODO: отправить в Sentry если настроен
    // if (window.Sentry) {
    //   window.Sentry.captureException(error, { contexts: { react: errorInfo } });
    // }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl p-8 text-center border border-slate-200 dark:border-slate-700 shadow-xl">
            <div className="text-6xl mb-4" role="img" aria-label="Предупреждение">
              ⚠️
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Что-то пошло не так
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
              Произошла ошибка при отображении страницы. Пожалуйста, обновите страницу или вернитесь назад.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors"
              >
                Обновить страницу
              </button>
              <button
                onClick={() => window.history.back()}
                className="px-6 py-3 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-white font-bold rounded-xl transition-colors"
              >
                Назад
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer font-semibold text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
                  Детали ошибки (только в development)
                </summary>
                <pre className="mt-3 p-3 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-auto text-xs text-red-600 dark:text-red-400 max-h-64">
                  {this.state.error.toString()}
                  {this.state.errorInfo && '\n\n'}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
