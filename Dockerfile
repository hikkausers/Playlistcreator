# Використовуємо офіційний образ Node.js
FROM node:18-slim

# Встановлюємо ffmpeg всередині контейнера
# RUN - це команда, яка виконується під час створення образу
RUN apt-get update && apt-get install -y ffmpeg

# Створюємо робочу директорію
WORKDIR /app

# Копіюємо файли package.json та package-lock.json
COPY package*.json ./

# Встановлюємо залежності вашого Node.js проєкту
RUN npm install

# Копіюємо решту файлів вашого проєкту в контейнер
COPY . .

# Відкриваємо порт, на якому працює ваш сервер
EXPOSE 3000

# Команда для запуску вашого сервера, коли контейнер стартує
CMD ["node", "server.js"]
