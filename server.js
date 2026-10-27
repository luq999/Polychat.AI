import "./src/env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { answer, answerStream, userFacingError, modelInfo } from "./src/rag.js";
import { vectorProvider } from "./src/vectorstore.js";

if (!process.env.GEMINI_API_KEY) {
  console.error("Не задан GEMINI_API_KEY (см. .env.example)");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  })
);
// сжатие не применяем к потоковому ответу: gzip копит данные в буфере и текст приходит одним куском
app.use(compression({ filter: (req, res) => (req.path === "/api/chat/stream" ? false : compression.filter(req, res)) }));
app.use(express.json({ limit: "50kb" }));

// не больше 20 запросов в минуту с одного IP — защищает ваш ключ Gemini
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Подожди минуту и попробуй снова." },
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Пустое сообщение" });
  if (message.length > 1000) return res.status(400).json({ error: "Сообщение слишком длинное" });

  try {
    const { reply, sources } = await answer(message, req.body.history);
    res.json({ reply, sources });
  } catch (err) {
    console.error("[/api/chat] этап:", err?.stage || "?", "|", err?.status || "", err?.message || err);
    res.status(502).json({ error: userFacingError(err) });
  }
});

// Потоковый ответ: отдаём NDJSON — по одной JSON-строке на кусок текста
app.post("/api/chat/stream", chatLimiter, async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Пустое сообщение" });
  if (message.length > 1000) return res.status(400).json({ error: "Сообщение слишком длинное" });

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // чтобы nginx не копил ответ в буфере
  res.flushHeaders();

  let closed = false;
  res.on("close", () => { closed = true; });
  const send = (obj) => {
    res.write(JSON.stringify(obj) + "\n");
    res.flush?.(); // compression иначе держит данные в буфере
  };
  send({ ping: 1 }); // сразу отправляем байты, чтобы браузер и прокси начали отдавать поток без буферизации

  try {
    for await (const part of answerStream(message, req.body.history)) {
      if (closed) break; // пользователь закрыл страницу
      if (part.status) send({ s: part.status });
      else if (part.text) send({ t: part.text });
      else if (part.done) send({ done: true, sources: part.sources });
    }
  } catch (err) {
    console.error("[/api/chat/stream] этап:", err?.stage || "?", "|", err?.status || "", err?.message || err);
    if (!closed) send({ error: userFacingError(err) });
  }
  res.end();
});

app.get("/api/health", (_req, res) => res.json({ ok: true, vectorDb: vectorProvider, models: modelInfo, cwd: process.cwd() }));

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`mospolyt.ai: http://localhost:${port} (векторная БД: ${vectorProvider})`);
  console.log(`Модели: основная=${modelInfo.chat}, запасная=${modelInfo.fallback}, эмбеддинги=${modelInfo.embed}`);
});
