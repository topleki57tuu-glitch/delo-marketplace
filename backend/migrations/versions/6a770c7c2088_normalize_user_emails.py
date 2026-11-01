"""normalize user emails

Почта аккаунтов приводится к каноническому виду: без пробелов по краям и в
нижнем регистре.

До этой ревизии регистрация сохраняла адрес как ввели, а права модератора
сравнивались без учёта регистра: рядом с admin@delo.ru можно было
зарегистрировать «Admin@delo.ru» и получить те же права. Теперь is_admin
требует канонический вид почты, а регистрация сразу его и сохраняет.

Приводим только адреса без «двойника» — другого аккаунта с той же почтой в
ином регистре. Иначе два аккаунта получили бы одинаковую почту, и
уникальный индекс уронил бы миграцию. Двойники остаются как есть: прав
модератора у них нет, а увидеть их можно командой
`bash scripts/admin_access.sh --check`.

Revision ID: 6a770c7c2088
Revises: e3c5a7d9f1b2
Create Date: 2026-11-01 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '6a770c7c2088'
down_revision: Union[str, Sequence[str], None] = 'e3c5a7d9f1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Отдельной константой — её же выполняет регресс-набор
# tests/security/check_admin_access.py на своей базе.
NORMALIZE_SQL = """
UPDATE users
SET email = lower(trim(email))
WHERE email IS NOT NULL
  AND email <> lower(trim(email))
  AND lower(trim(email)) IN (
      SELECT lower(trim(email)) FROM users
      WHERE email IS NOT NULL
      GROUP BY lower(trim(email))
      HAVING count(*) = 1
  )
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(NORMALIZE_SQL)


def downgrade() -> None:
    """Downgrade schema.

    Исходный регистр не сохранялся, вернуть его нечем — и незачем: почтовые
    сервисы регистр адреса не различают.
    """
