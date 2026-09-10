module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'uvicorn',
      args: 'main:app --host 0.0.0.0 --port 8000',
      cwd: '/home/user/webapp/backend',
      interpreter: 'none',
      env: {
        DATABASE_URL: 'sqlite:///./marketplace_v3.db',
        ENV: 'development',
        SECRET_KEY: 'marketplace_dev_secret_key'
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
