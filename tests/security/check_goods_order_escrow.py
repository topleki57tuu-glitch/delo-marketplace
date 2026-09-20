"""
Регресс: эскроу в заказах товаров — заморозка, выплата, возврат.

Запуск (из корня репозитория):
    python tests/security/check_goods_order_escrow.py

Код возврата: 0 — деньги не создаются и не теряются, 1 — расхождение.

Почему этот файл существует
---------------------------
`app/api/products.py` — это не только каталог. Там лежит весь жизненный цикл
заказа товара с деньгами: `create_order` (заморозка), `confirm_order`,
`ship_order`, `complete_order` (выплата продавцу за вычетом комиссии),
`cancel_order` (возврат), `open_order_dispute` — 15 роутов.

В CI не было **ни одной** проверки на них: слова `order` не встречалось ни
в одном файле `tests/`. То есть все правки, которые тут уже сделаны
(атомарное списание, захват остатка через UPDATE, обязательный продавец при
выплате, отмена подтверждённого заказа, спор по товару), можно было откатить
молча — ровно тот сценарий, ради которого пишутся эти наборы.

Что проверяется
---------------
1. Создание заказа морозит деньги покупателя и уменьшает остаток товара;
2. полный цикл pending → confirmed → shipped → completed платит продавцу
   сумму минус комиссия, и только ему;
3. повторное завершение денег не платит;
4. завершить может только покупатель, подтвердить и отправить — только продавец;
5. отмена возвращает покупателю полную сумму и остаток товара;
6. отмена после отправки запрещена (иначе продавец теряет товар и деньги);
7. продавец с действующей PRO не платит комиссию;
8. нельзя купить свой товар, больше остатка или без денег;
9. спор замораживает деньги: ни завершить, ни отменить;
10. сколько денег было у участников плюс комиссия — столько и осталось.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))
sys.path.insert(0, os.path.join(REPO_ROOT, "tests"))

from _helpers import isolate_env  # noqa: E402

# Окружение задаём сами: в CI джоба выставляет CSRF_ENABLED=1 и боевой
# DATABASE_URL, через setdefault их не перекрыть (см. isolate_env).
isolate_env("check_goods_order_escrow")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from app.core.database import Base, engine, SessionLocal  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.models import (  # noqa: E402
    Order, OrderStatus, Product, ProductCategory, ProductCondition,
    Transaction, TransactionType, User, UserRole,
)

BUYER_START = 100_000
PRICE = 10_000
FEE_PERCENT = 5

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  OK  {name}" + (f" | {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" | {detail}" if detail else ""))


Base.metadata.create_all(bind=engine)

# naive UTC: колонки pro_until/created_at объявлены как Column(DateTime)
# без timezone=True, поэтому aware-значение сюда не положить
now = datetime.now(timezone.utc).replace(tzinfo=None)
db = SessionLocal()
buyer = User(email="buyer@goods.ru", hashed_password="x", role=UserRole.customer,
             name="Покупатель", balance=BUYER_START)
seller = User(email="seller@goods.ru", hashed_password="x", role=UserRole.specialist,
              name="Продавец", balance=0)
pro = User(email="pro@goods.ru", hashed_password="x", role=UserRole.specialist,
           name="PRO продавец", balance=0, is_pro=True, pro_until=now + timedelta(days=30))
stranger = User(email="stranger@goods.ru", hashed_password="x", role=UserRole.customer,
                name="Посторонний", balance=0)
db.add_all([buyer, seller, pro, stranger])
db.commit()

products = {
    "plain": Product(seller_id=seller.id, title="ДРЕЛЬ", description="аккумуляторная",
                     category=ProductCategory.other, condition=ProductCondition.new,
                     price=PRICE, stock=3, status="active", delivery_options="both"),
    "pro": Product(seller_id=pro.id, title="ШУРУПОВЁРТ", description="сетевой",
                   category=ProductCategory.other, condition=ProductCondition.new,
                   price=PRICE, stock=2, status="active", delivery_options="both"),
    "last": Product(seller_id=seller.id, title="ПОСЛЕДНИЙ", description="одна штука",
                    category=ProductCategory.other, condition=ProductCondition.new,
                    price=PRICE, stock=1, status="active", delivery_options="both"),
}
db.add_all(products.values())
db.commit()

ids = {u.email: u.id for u in (buyer, seller, pro, stranger)}
pid = {k: p.id for k, p in products.items()}
db.close()

client = TestClient(main.app, raise_server_exceptions=False)


def token(email: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ids[email])})}"}


def balance(email: str) -> int:
    db = SessionLocal()
    try:
        return db.query(User).filter(User.id == ids[email]).first().balance or 0
    finally:
        db.close()


def stock(key: str) -> int:
    db = SessionLocal()
    try:
        return db.query(Product).filter(Product.id == pid[key]).first().stock
    finally:
        db.close()


def product_status(key: str) -> str:
    db = SessionLocal()
    try:
        return db.query(Product).filter(Product.id == pid[key]).first().status
    finally:
        db.close()


def order_row(order_id: int) -> dict:
    db = SessionLocal()
    try:
        o = db.query(Order).filter(Order.id == order_id).first()
        return {
            "id": o.id,
            "status": o.status.value if hasattr(o.status, "value") else str(o.status),
            "total_price": o.total_price,
            "platform_fee": o.platform_fee,
            "buyer_id": o.buyer_id,
            "seller_id": o.seller_id,
            "escrow_transaction_id": o.escrow_transaction_id,
        }
    finally:
        db.close()


def escrow_transactions() -> list:
    db = SessionLocal()
    try:
        rows = db.query(Transaction).filter(
            Transaction.type.in_([TransactionType.escrow_hold,
                                  TransactionType.escrow_release,
                                  TransactionType.escrow_refund])
        ).all()
        return [{"type": t.type.value, "amount": t.amount, "user_id": t.user_id} for t in rows]
    finally:
        db.close()


def buy(key: str, quantity: int = 1, method: str = "pickup", who: str = "buyer@goods.ru"):
    return client.post(
        "/products/orders",
        json={"product_id": pid[key], "quantity": quantity, "delivery_method": method},
        headers=token(who),
    )


print("РЕГРЕСС: эскроу в заказах товаров")

# --- 1. Создание заказа -------------------------------------------------------
print("\n1. Создание заказа морозит деньги")
before_buyer = balance("buyer@goods.ru")
before_stock = stock("plain")
r = buy("plain", quantity=2)
check("заказ создан", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
order_id = r.json().get("order_id") if r.status_code == 200 else None

if not order_id:
    print("\nЗаказ не создался — дальше проверять нечего.")
    print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
    sys.exit(1)

o = order_row(order_id)
check("статус pending", o["status"] == "pending", f"status={o['status']}")
check("баланс покупателя уменьшился на сумму заказа",
      balance("buyer@goods.ru") == before_buyer - PRICE * 2,
      f"{before_buyer} -> {balance('buyer@goods.ru')}")
check("остаток товара уменьшился на количество",
      stock("plain") == before_stock - 2, f"{before_stock} -> {stock('plain')}")
check("комиссия 5% посчитана", o["platform_fee"] == PRICE * 2 * FEE_PERCENT // 100,
      f"fee={o['platform_fee']}")
check("заказ ссылается на транзакцию эскроу", bool(o["escrow_transaction_id"]),
      f"escrow_transaction_id={o['escrow_transaction_id']}")
holds = [t for t in escrow_transactions() if t["type"] == "escrow_hold"]
check("запись escrow_hold создана на сумму заказа",
      any(t["amount"] == PRICE * 2 and t["user_id"] == ids["buyer@goods.ru"] for t in holds),
      f"hold={[(t['amount'], t['user_id']) for t in holds]}")

# --- 2. Полный цикл до выплаты ------------------------------------------------
print("\n2. Полный цикл: подтверждение → отправка → выплата")
r = client.post(f"/products/orders/{order_id}/confirm", headers=token("seller@goods.ru"))
check("продавец подтвердил", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
check("статус confirmed", order_row(order_id)["status"] == "confirmed")

r = client.post(f"/products/orders/{order_id}/ship",
                json={"tracking_number": "TRK-001"}, headers=token("seller@goods.ru"))
check("продавец отправил", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
check("статус shipped", order_row(order_id)["status"] == "shipped")

seller_before = balance("seller@goods.ru")
r = client.post(f"/products/orders/{order_id}/complete", headers=token("buyer@goods.ru"))
check("покупатель завершил", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
expected_payout = PRICE * 2 - o["platform_fee"]
check("продавцу выплачена сумма минус комиссия",
      balance("seller@goods.ru") == seller_before + expected_payout,
      f"{seller_before} -> {balance('seller@goods.ru')}, ожидалось +{expected_payout}")
check("в ответе та же сумма",
      r.status_code == 200 and r.json().get("released") == expected_payout,
      f"released={r.json().get('released') if r.status_code == 200 else '-'}")
check("статус completed", order_row(order_id)["status"] == "completed")
check("комиссия покупателю не возвращается",
      balance("buyer@goods.ru") == before_buyer - PRICE * 2,
      f"balance={balance('buyer@goods.ru')}")
releases = [t for t in escrow_transactions() if t["type"] == "escrow_release"]
check("запись escrow_release создана",
      any(t["amount"] == expected_payout and t["user_id"] == ids["seller@goods.ru"]
          for t in releases),
      f"release={[(t['amount'], t['user_id']) for t in releases]}")

# --- 3. Двойная выплата -------------------------------------------------------
print("\n3. Повторное завершение денег не платит")
seller_after = balance("seller@goods.ru")
r = client.post(f"/products/orders/{order_id}/complete", headers=token("buyer@goods.ru"))
check("повторное завершение отклонено", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")
check("баланс продавца не изменился", balance("seller@goods.ru") == seller_after,
      f"balance={balance('seller@goods.ru')}")

# --- 4. Роли ------------------------------------------------------------------
print("\n4. Кто что может")
r2 = buy("last")
last_order = r2.json().get("order_id") if r2.status_code == 200 else None
check("второй заказ создан", bool(last_order), f"http={r2.status_code}")

if last_order:
    r = client.post(f"/products/orders/{last_order}/complete", headers=token("seller@goods.ru"))
    check("завершить может только покупатель", r.status_code == 403,
          f"http={r.status_code}")
    r = client.post(f"/products/orders/{last_order}/confirm", headers=token("buyer@goods.ru"))
    check("подтвердить может только продавец", r.status_code == 403, f"http={r.status_code}")
    r = client.post(f"/products/orders/{last_order}/ship",
                    json={"tracking_number": "X"}, headers=token("buyer@goods.ru"))
    check("отправить может только продавец", r.status_code == 403, f"http={r.status_code}")

    print("\n5. Отмена возвращает деньги и остаток")
    buyer_before_cancel = balance("buyer@goods.ru")
    stock_before_cancel = stock("last")
    r = client.post(f"/products/orders/{last_order}/cancel", headers=token("buyer@goods.ru"))
    check("отмена pending прошла", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
    check("статус cancelled", order_row(last_order)["status"] == "cancelled")
    check("покупателю вернулась полная сумма",
          balance("buyer@goods.ru") == buyer_before_cancel + PRICE,
          f"{buyer_before_cancel} -> {balance('buyer@goods.ru')}")
    check("остаток товара вернулся",
          stock("last") == stock_before_cancel + 1, f"stock={stock('last')}")
    refunds = [t for t in escrow_transactions() if t["type"] == "escrow_refund"]
    check("запись escrow_refund создана",
          any(t["amount"] == PRICE and t["user_id"] == ids["buyer@goods.ru"] for t in refunds),
          f"refund={[(t['amount'], t['user_id']) for t in refunds]}")

    r = client.post(f"/products/orders/{last_order}/cancel", headers=token("buyer@goods.ru"))
    check("повторная отмена не возвращает деньги дважды", r.status_code == 400,
          f"http={r.status_code}")

# --- 6. Отмена после отправки -------------------------------------------------
print("\n6. Отмена после отправки запрещена")
r3 = buy("pro")
pro_order = r3.json().get("order_id") if r3.status_code == 200 else None
check("заказ у PRO-продавца создан", bool(pro_order), f"http={r3.status_code}")
if pro_order:
    client.post(f"/products/orders/{pro_order}/confirm", headers=token("pro@goods.ru"))
    client.post(f"/products/orders/{pro_order}/ship",
                json={"tracking_number": "TRK-002"}, headers=token("pro@goods.ru"))
    r = client.post(f"/products/orders/{pro_order}/cancel", headers=token("buyer@goods.ru"))
    check("отмена отправленного заказа отклонена", r.status_code == 400,
          f"http={r.status_code} {r.text[:80]}")

    print("\n7. PRO-продавец комиссию не платит")
    pro_before = balance("pro@goods.ru")
    r = client.post(f"/products/orders/{pro_order}/complete", headers=token("buyer@goods.ru"))
    check("заказ завершён", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
    check("выплата равна полной сумме",
          balance("pro@goods.ru") == pro_before + PRICE,
          f"{pro_before} -> {balance('pro@goods.ru')}, ожидалось +{PRICE}")
    check("комиссия нулевая", order_row(pro_order)["platform_fee"] == 0,
          f"fee={order_row(pro_order)['platform_fee']}")

# --- 8. Ограничения покупки ---------------------------------------------------
print("\n8. Ограничения покупки")
r = client.post("/products/orders",
                json={"product_id": pid["plain"], "quantity": 1, "delivery_method": "pickup"},
                headers=token("seller@goods.ru"))
check("свой товар купить нельзя", r.status_code == 400, f"http={r.status_code}")

r = buy("plain", quantity=99)
check("больше остатка купить нельзя", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")

poor_before = balance("stranger@goods.ru")
r = buy("plain", quantity=1, who="stranger@goods.ru")
check("без денег купить нельзя", r.status_code == 400, f"http={r.status_code}")
check("баланс безденежного не изменился",
      balance("stranger@goods.ru") == poor_before, f"balance={balance('stranger@goods.ru')}")

r = client.post("/products/orders",
                json={"product_id": pid["plain"], "quantity": 1,
                      "delivery_method": "delivery"},
                headers=token("buyer@goods.ru"))
check("доставка без адреса отклонена", r.status_code == 400,
      f"http={r.status_code} {r.text[:80]}")

# --- 9. Спор ------------------------------------------------------------------
print("\n9. Спор замораживает деньги")
r = buy("plain")
dispute_order = r.json().get("order_id") if r.status_code == 200 else None
check("заказ под спор создан", bool(dispute_order), f"http={r.status_code}")
if dispute_order:
    client.post(f"/products/orders/{dispute_order}/confirm", headers=token("seller@goods.ru"))
    client.post(f"/products/orders/{dispute_order}/ship",
                json={"tracking_number": "TRK-003"}, headers=token("seller@goods.ru"))
    r = client.post(f"/products/orders/{dispute_order}/dispute",
                    json={"reason": "Товар пришёл повреждённым"}, headers=token("buyer@goods.ru"))
    check("спор открыт", r.status_code == 200, f"http={r.status_code} {r.text[:80]}")
    check("статус disputed", order_row(dispute_order)["status"] == "disputed")

    frozen = balance("seller@goods.ru")
    r = client.post(f"/products/orders/{dispute_order}/complete", headers=token("buyer@goods.ru"))
    check("завершить оспоренный заказ нельзя", r.status_code == 400, f"http={r.status_code}")
    r = client.post(f"/products/orders/{dispute_order}/cancel", headers=token("buyer@goods.ru"))
    check("отменить оспоренный заказ нельзя", r.status_code == 400, f"http={r.status_code}")
    check("деньги остались заморожены", balance("seller@goods.ru") == frozen,
          f"balance={balance('seller@goods.ru')}")

    r = client.post(f"/products/orders/{dispute_order}/dispute",
                    json={"reason": "Ещё раз то же самое"}, headers=token("seller@goods.ru"))
    check("второй спор по тому же заказу отклонён", r.status_code == 400, f"http={r.status_code}")

    r = client.post(f"/products/orders/{dispute_order}/dispute",
                    json={"reason": "коротко"}, headers=token("buyer@goods.ru"))
    check("пустая причина отклонена", r.status_code == 400, f"http={r.status_code}")

# --- 10. Сохранение денег -----------------------------------------------------
print("\n10. Деньги не создаются и не исчезают")
db = SessionLocal()
try:
    balances = sum((u.balance or 0) for u in db.query(User).all())
    fees = sum(o.platform_fee or 0 for o in db.query(Order).filter(
        Order.status == OrderStatus.completed).all())
    # Деньги по незавершённым заказам лежат в эскроу: покупатель их уже отдал,
    # продавец ещё не получил. Без этой части инвариант не сходится ровно
    # на сумму оспоренного заказа — и это не потеря денег, а заморозка.
    held = sum(o.total_price or 0 for o in db.query(Order).filter(
        Order.status.in_([OrderStatus.pending, OrderStatus.confirmed,
                          OrderStatus.shipped, OrderStatus.disputed])).all())
finally:
    db.close()

check("балансы + комиссия + эскроу равны стартовой сумме",
      balances + fees + held == BUYER_START,
      f"балансы={balances} + комиссия={fees} + эскроу={held} = "
      f"{balances + fees + held}, старт={BUYER_START}")
check("в эскроу действительно что-то осталось (иначе проверка выше пустая)",
      held > 0, f"эскроу={held}")

# --- 11. Сериализация товара --------------------------------------------------
# `_serialize_product` — единственное представление товара сразу для списка,
# «моих товаров» и деталей. Раньше пустая колонка превращалась в строку "None".
print("\n11. Товар с пустыми колонками отдаётся как null")
db = SessionLocal()
orphan = Product(seller_id=ids["seller@goods.ru"], title="БЕЗ КАТЕГОРИИ",
                 description="колонки не заполнены",
                 price=1000, stock=1, status="active", delivery_options="both")
db.add(orphan)
db.commit()
orphan_id = orphan.id
db.close()

r = client.get(f"/products/{orphan_id}")
check("деталь товара отвечает 200", r.status_code == 200, f"http={r.status_code}")
body = r.json() if r.status_code == 200 else {}
check("category — null, а не строка 'None'",
      body.get("category", "нет поля") is None,
      f"category={body.get('category')!r}")
check("ни одно поле не превратилось в строку 'None'",
      "None" not in [body.get("category"), body.get("condition")],
      f"category={body.get('category')!r} condition={body.get('condition')!r}")

print(f"\n=== ИТОГ: passed={passed} failed={failed} ===")
sys.exit(1 if failed else 0)
