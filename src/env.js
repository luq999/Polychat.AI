// Загружает .env так, чтобы значения из файла ВСЕГДА побеждали переменные окружения Windows/терминала.
import dotenv from "dotenv";

const r = dotenv.config({ override: true });
if (r.error) console.warn(`Файл .env не найден в папке ${process.cwd()} — запускай npm start из папки проекта.`);
