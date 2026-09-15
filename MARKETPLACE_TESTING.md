# Тестирование маркетплейса товаров

## 1. Подготовка
- ✅ Backend запущен: http://localhost:8000
- ✅ Frontend запущен: http://localhost:3000
- ✅ База данных с демо данными готова
- ✅ Исправлен конфликт роутов (orders перед {product_id})

## 2. API тесты (выполнены)

### ✅ Список товаров
```bash
curl http://localhost:8000/products/
```
**Результат**: 12 товаров

### ✅ Фильтр по категории
```bash
curl "http://localhost:8000/products/?category=electronics"
```
**Результат**: 3 товара

### ✅ Детали товара
```bash
curl http://localhost:8000/products/1
```
**Результат**: iPhone 14 Pro с рейтингом продавца

### ✅ Авторизация
```bash
curl -X POST http://localhost:8000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=anna@delo.ru&password=demo123"
```
**Результат**: Токен получен

### ✅ Мои заказы (пустые)
```bash
curl http://localhost:8000/products/orders \
  -H "Authorization: Bearer TOKEN"
```
**Результат**: purchases: 0, sales: 0

### ✅ Создание заказа
```bash
curl -X POST http://localhost:8000/products/orders \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"product_id": 12, "quantity": 1, "delivery_method": "delivery", "delivery_address": "Moscow, Lenin st, 1"}'
```
**Результат**: Заказ создан, order_id: 3
**Баланс Anna**: было 10470₽, стало 2970₽ (потрачено 7500₽)

## 3. Frontend тесты (нужно выполнить)

### A. Каталог товаров
1. Открыть http://localhost:3000/products
2. Проверить отображение товаров
3. Протестировать фильтры (категории, состояние, цена)
4. Протестировать поиск

### B. Детальная страница товара
1. Кликнуть на товар
2. Проверить галерею, описание, информацию о продавце
3. Проверить форму заказа

### C. Создание товара
1. Войти как продавец (igor@delo.ru / demo123)
2. Открыть /create-product
3. Создать новый товар с фото

### D. Редактирование товара  
1. Открыть /my-products
2. Кликнуть "Редактировать"
3. Изменить данные товара
4. Сохранить

### E. Управление товарами
1. Проверить /my-products
2. Просмотреть статистику
3. Удалить товар

### F. Покупка товара (flow заказа)
**Покупатель (anna@delo.ru)**:
1. Выбрать товар
2. Оформить заказ
3. Проверить /my-orders (покупки)

**Продавец (seller того товара)**:
1. Открыть /my-orders (продажи)
2. Подтвердить заказ
3. Указать трек-номер и отправить

**Покупатель**:
1. Увидеть статус "shipped"
2. Подтвердить получение
3. Проверить что деньги переведены продавцу (минус 5%)

### G. Отмена заказа
1. Создать новый заказ
2. Отменить пока статус = pending
3. Проверить возврат средств

## 4. Проверка эскроу и комиссий

### Тест 1: Создан заказ #3
- Товар: Конструктор LEGO (750000 копеек = 7500₽)
- Покупатель: Anna (баланс до: 1047000, после: 297000)
- Деньги заморожены в эскроу: 750000 копеек
- Stock товара: было 2, стало 1

### Тест 2: Завершение заказа (нужно выполнить)
- Продавец подтверждает → статус confirmed
- Продавец отправляет → статус shipped
- Покупатель получает → статус completed
- Расчёт: 750000 - 5% = 712500 копеек продавцу
- Комиссия платформы: 37500 копеек

## 5. Статус выполнения

### Backend ✅ Готово
- [x] Модели Product, Order
- [x] API эндпоинты для товаров
- [x] API эндпоинты для заказов
- [x] Эскроу логика
- [x] Комиссия 5%
- [x] Уведомления
- [x] Фильтры и поиск
- [x] Исправлен конфликт роутов

### Frontend ✅ Готово
- [x] ProductsPage (каталог)
- [x] ProductDetailPage (детали товара)
- [x] CreateProductPage (создание)
- [x] EditProductPage (редактирование)
- [x] MyProductsPage (управление товарами)
- [x] MyOrdersPage (мои заказы)
- [x] Навигация и роутинг

### Тестирование ⏳ В процессе
- [x] Backend API тесты
- [x] Создание заказа через API
- [ ] Frontend UI тесты
- [ ] Полный flow покупки
- [ ] Тест эскроу и комиссий
- [ ] Тест отмены заказа

## 6. Следующие шаги

1. **Протестировать через браузер**:
   - Открыть http://localhost:3000
   - Пройти все сценарии из раздела 3

2. **Зафиксировать результаты**:
   - Скриншоты основных страниц
   - Проверка транзакций в БД
   - Проверка балансов после операций

3. **Документировать найденные баги** (если будут)

4. **Подготовить отчёт о тестировании**

## 7. Команды для быстрого тестирования

### Проверить баланс Anna:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/login -H "Content-Type: application/x-www-form-urlencoded" -d "username=anna@delo.ru&password=demo123" | python -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8000/users/me -H "Authorization: Bearer $TOKEN" | python -c "import sys, json; u=json.load(sys.stdin); print(f\"Balance: {u['balance']/100} rubles\")"
```

### Проверить заказы Anna:
```bash
curl -s http://localhost:8000/products/orders -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

### Создать ещё один заказ:
```bash
curl -s -X POST http://localhost:8000/products/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"product_id": 4, "quantity": 1, "delivery_method": "pickup", "delivery_address": null}'
```

