"""Преобразование enum-значения в то, что уходит в JSON.

Зачем отдельный модуль
----------------------
По коду разбросано 23 копии одного и того же выражения:

    "category": product.category.value if hasattr(product.category, "value")
                else str(product.category)

Оно выглядит защитным («значение может быть и enum, и строкой»), но у него
есть молчаливый побочный эффект: если колонка пуста, `hasattr(None, "value")`
ложно, и `str(None)` даёт СТРОКУ `"None"`. В JSON уезжает не `null`, а
категория/статус/роль с названием None — и фронт потом не совпадает ни с одним
фильтром, а в базе при этом всё в порядке.

Заметить это можно только тогда, когда колонка действительно пуста, а почти
все такие колонки объявлены nullable: `products.category`, `products.condition`,
`tasks.status`, `orders.status`, `users.role` и другие. Сейчас их заполняют
и API-схемы, и seed, поэтому дефект латентный — но он проявляется сразу, как
только строку создаёт миграция, админский скрипт или ручная правка.

Единственная реализация вместо копий — по той же причине, по которой появился
`app/core/presence.py`: копии расходятся, а расхождение здесь не видно глазами.
"""
from typing import Any, Optional


def enum_value(value: Optional[Any]) -> Optional[str]:
    """Значение enum как строка; отсутствующее значение остаётся None.

    >>> enum_value(ProductCategory.other)
    'other'
    >>> enum_value("electronics")
    'electronics'
    >>> enum_value(None) is None
    True
    """
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)
