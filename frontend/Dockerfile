# Stage 1: Build
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Ключ JavaScript API Яндекс Карт (необязательный). Vite встраивает его в код
# сайта при сборке, поэтому он нужен здесь, а не при запуске контейнера:
# docker-compose.prod.yml передаёт его из .env. Пустой — карта работает без
# ключа (в консоли браузера предупреждение «Invalid API key»).
ARG VITE_YANDEX_MAPS_API_KEY=""
ENV VITE_YANDEX_MAPS_API_KEY=$VITE_YANDEX_MAPS_API_KEY
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Заголовки безопасности — отдельным файлом вне conf.d: nginx подключает
# из conf.d всё подряд на уровне http, а этот файл включается в location.
COPY nginx-security-headers.conf /etc/nginx/snippets/delo-security-headers.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
