/**
 * PM2 — локальный запуск «ДЕЛО» без Docker (API, Vite, Celery worker и beat).
 *
 * Секреты здесь намеренно НЕ хранятся. Раньше в этом файле лежали
 * `SECRET_KEY: 'marketplace_dev_secret_key'` и `ADMIN_EMAILS: 'admin@delo.ru'`:
 * первый — предсказуемый ключ подписи JWT в репозитории, второй — тот самый
 * дефолтный модератор, который из кода уже убрали (почта при регистрации не
 * подтверждается, поэтому права получал любой, кто первым занял адрес).
 *
 * Все значения читаются из окружения. Для локального запуска положите их в
 * `.env` (см. `.env.example`) — config.py сам подхватит файл через dotenv.
 * Без SECRET_KEY backend в development сгенерирует случайный ключ, а без
 * ADMIN_EMAILS модераторов не будет ни одного.
 *
 * Про worker и beat: они добавлены сюда, потому что иначе подсистема задач
 * снова оказалась бы «есть в коде, нет в контуре» — именно так она и жила до
 * этого. Обоим нужен Redis: без него процессы поднимутся, но будут ждать
 * брокера и переподключаться, задачи выполняться не будут.
 */
module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'uvicorn',
      args: 'main:app --host 0.0.0.0 --port 8000',
      cwd: '/home/user/webapp/backend',
      interpreter: 'none',
      env: {
        ENV: process.env.ENV || 'development',
        DATABASE_URL: process.env.DATABASE_URL || 'sqlite:///./marketplace_v3.db',
        FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
        // SECRET_KEY и ADMIN_EMAILS — только из окружения/.env, не из файла
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    },
    {
      name: 'frontend',
      script: 'npx',
      args: 'vite --host 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp/frontend',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    },
    {
      // Воркер Celery. Без него задачи из app/tasks/* не выполняет никто:
      // ни уборка уведомлений и истёкших токенов, ни снятие флагов PRO.
      name: 'celery-worker',
      script: 'celery',
      args: '-A app.core.celery_app worker --loglevel=info',
      cwd: '/home/user/webapp/backend',
      interpreter: 'none',
      watch: false,
      // Celery сам управляет параллелизмом (--concurrency), поэтому второй
      // экземпляр процесса не нужен: два воркера под одним PM2 дрались бы
      // за одни и те же задачи.
      instances: 1,
      exec_mode: 'fork'
    },
    {
      // Планировщик. Воркер исполняет задачи, но не решает, когда их
      // запускать — за расписание отвечает beat, и это отдельный процесс.
      name: 'celery-beat',
      script: 'celery',
      args: '-A app.core.celery_app beat --loglevel=info --schedule=/home/user/webapp/backend/beat-schedule/celerybeat-schedule',
      cwd: '/home/user/webapp/backend',
      interpreter: 'none',
      watch: false,
      // Два beat с одним файлом расписания — это дубли задач по расписанию.
      // Ровно один процесс, и это не настройка «на всякий случай».
      instances: 1,
      exec_mode: 'fork'
    }
  ]
};
