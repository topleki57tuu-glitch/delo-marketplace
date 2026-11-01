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
