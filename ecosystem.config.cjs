/**
 * PM2 — локальный запуск «ДЕЛО» без Docker (два процесса: API и Vite).
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
    }
  ]
};
