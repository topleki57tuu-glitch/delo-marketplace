/**
 * Подписи категорий заданий. Раньше на странице задания выводился сырой
 * идентификатор («development»), потому что словарь жил только внутри
 * TasksPage и CreateTaskPage. Новые места берут подписи отсюда.
 */
export const TASK_CATEGORY_LABELS = {
  development: 'Разработка и IT',
  design: 'Дизайн и графика',
  writing: 'Тексты и переводы',
  repairs: 'Ремонт и строительство',
  cleaning: 'Уборка и клининг',
  delivery: 'Курьеры и доставка',
  photo_video: 'Фото и видео',
  tutoring: 'Репетиторы и обучение',
  beauty: 'Красота и здоровье',
  events: 'Мероприятия',
  business: 'Бизнес-услуги',
  other: 'Другое',
};

export const taskCategoryLabel = (id) => TASK_CATEGORY_LABELS[id] || id || 'Другое';

/** Подписи категорий товаров — общие для витрины, карточки и форм. */
export const PRODUCT_CATEGORY_LABELS = {
  electronics: 'Электроника',
  clothing: 'Одежда и обувь',
  home: 'Товары для дома',
  hobby: 'Хобби и развлечения',
  auto: 'Авто и мото',
  kids: 'Детские товары',
  other: 'Другое',
};

export const PRODUCT_CATEGORY_OPTIONS = Object.entries(PRODUCT_CATEGORY_LABELS).map(([id, label]) => ({ id, label }));

export const productCategoryLabel = (id) => PRODUCT_CATEGORY_LABELS[id] || 'Другое';
