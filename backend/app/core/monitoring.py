"""
SQLAlchemy query performance monitoring.

Логирует медленные запросы (>100ms) для выявления узких мест.
В production используйте совместно с APM (Sentry, DataDog).
"""
import time
import logging
from sqlalchemy import event
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def setup_query_monitoring(slow_query_threshold_ms: float = 100):
    """
    Настраивает мониторинг производительности SQL запросов.

    Args:
        slow_query_threshold_ms: Порог в миллисекундах для slow query (по умолчанию 100ms)

    Логирует:
    - Медленные запросы (>threshold) с WARNING уровнем
    - Очень медленные запросы (>1s) с ERROR уровнем
    - Статистику в конце каждого запроса (в DEBUG режиме)
    """

    @event.listens_for(Engine, "before_cursor_execute")
    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """Сохраняет время начала выполнения запроса."""
        conn.info.setdefault('query_start_time', []).append(time.time())

    @event.listens_for(Engine, "after_cursor_execute")
    def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        """Вычисляет время выполнения и логирует медленные запросы."""
        total_time = time.time() - conn.info['query_start_time'].pop()
        total_ms = total_time * 1000

        # Очень медленные запросы (>1s) - критично
        if total_ms > 1000:
            logger.error(
                f"VERY SLOW QUERY ({total_ms:.1f}ms): {statement[:500]}"
            )
        # Медленные запросы (>threshold)
        elif total_ms > slow_query_threshold_ms:
            logger.warning(
                f"Slow query ({total_ms:.1f}ms): {statement[:300]}"
            )
        # Все запросы в debug режиме
        else:
            logger.debug(f"Query ({total_ms:.1f}ms): {statement[:200]}")


def get_connection_pool_status(engine) -> dict:
    """
    Возвращает статус connection pool.

    Полезно для мониторинга утечек коннектов и настройки pool_size.
    """
    pool = engine.pool
    return {
        "size": pool.size(),
        "checked_in": pool.checkedin(),
        "checked_out": pool.checkedout(),
        "overflow": pool.overflow(),
        "total_connections": pool.size() + pool.overflow(),
    }


# Query statistics collector (опционально, для детального анализа)
class QueryStatsCollector:
    """
    Собирает статистику по выполненным запросам.

    Usage:
        stats = QueryStatsCollector()
        stats.enable()
        # ... выполнение запросов ...
        print(stats.get_summary())
    """

    def __init__(self):
        self.queries = []
        self.enabled = False

    def enable(self):
        """Начать сбор статистики."""
        self.enabled = True
        self.queries = []

        @event.listens_for(Engine, "after_cursor_execute")
        def collect_query_stats(conn, cursor, statement, parameters, context, executemany):
            if self.enabled:
                duration = time.time() - conn.info['query_start_time'][-1]
                self.queries.append({
                    'statement': statement[:200],
                    'duration_ms': duration * 1000,
                    'timestamp': time.time()
                })

    def disable(self):
        """Остановить сбор статистики."""
        self.enabled = False

    def get_summary(self) -> dict:
        """Получить сводку по собранной статистике."""
        if not self.queries:
            return {"total": 0}

        durations = [q['duration_ms'] for q in self.queries]
        return {
            "total_queries": len(self.queries),
            "total_time_ms": sum(durations),
            "avg_time_ms": sum(durations) / len(durations),
            "min_time_ms": min(durations),
            "max_time_ms": max(durations),
            "slowest_query": max(self.queries, key=lambda q: q['duration_ms'])
        }

    def get_top_slowest(self, n: int = 10) -> list:
        """Получить N самых медленных запросов."""
        sorted_queries = sorted(self.queries, key=lambda q: q['duration_ms'], reverse=True)
        return sorted_queries[:n]
