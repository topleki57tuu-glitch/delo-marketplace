# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
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
