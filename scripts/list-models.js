// Показывает модели Gemini, доступные вашему ключу, и какие из них умеют генерировать текст.
// Запуск: npm run models
import "../src/env.js";
import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
  console.error("Не задан GEMINI_API_KEY в .env");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const chat = [], embed = [];
for await (const m of await ai.models.list()) {
  const name = (m.name || "").replace(/^models\//, "");
  const actions = m.supportedActions || [];
  if (actions.includes("generateContent")) chat.push(name);
  if (actions.includes("embedContent")) embed.push(name);
}

console.log("\nДля ответов (GEMINI_CHAT_MODEL / GEMINI_FALLBACK_MODEL):");
chat.sort().forEach((n) => console.log("  " + n));
console.log("\nДля эмбеддингов (GEMINI_EMBED_MODEL):");
embed.sort().forEach((n) => console.log("  " + n));
console.log();
