import "../src/env.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js"; 

import { embed } from "../src/rag.js";
import { getStore, vectorProvider } from "../src/vectorstore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "knowledge");
const CACHE_FILE = path.join(__dirname, "..", ".ingest-cache.json");

const CHUNK = 900;   
const OVERLAP = 150; 
const SUPPORTED = /\.(md|txt|pdf|docx)$/i;

const FORCE_REINGEST = process.argv.includes("--force");
const SYNC_ONLY = process.argv.includes("--sync-only");


async function loadCache() {
  if (FORCE_REINGEST) return {};
  try {
    const data = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}


async function walk(d) {
  const out = [];
  for (const e of await fs.readdir(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (SUPPORTED.test(e.name)) out.push(full);
  }
  return out;
}

async function readFileText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") {
    const { text } = await pdfParse(await fs.readFile(file));
    
    return text.replace(/\r/g, "").replace(/-\n(?=\p{Ll})/gu, "").replace(/\n(?!\n)/g, " ");
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ path: file });
    return value;
  }
  return fs.readFile(file, "utf8");
}


function chunkText(text) {
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (cur && (cur + "\n\n" + p).length > CHUNK) {
      chunks.push(cur);
      cur = cur.slice(-OVERLAP) + "\n\n" + p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
    while (cur.length > CHUNK * 1.6) { 
      chunks.push(cur.slice(0, CHUNK));
      cur = cur.slice(CHUNK - OVERLAP);
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}


const files = await walk(dir);
if (!files.length) {
  console.error("В папке knowledge/ нет файлов .md, .txt, .pdf или .docx");
  process.exit(1);
}

const cache = await loadCache();
const pending = [];
let skippedCount = 0;

for (const file of files) {
  const rel = path.relative(dir, file).split(path.sep).join("/");
  let text = "";
  try {
    text = await readFileText(file);
  } catch (err) {
    console.warn(`✗ ${rel}: не удалось прочитать (${err.message})`);
    continue;
  }
  const chunks = chunkText(text);
  if (!chunks.length) {
    console.warn(`✗ ${rel}: текста нет (возможно, это скан — нужен OCR)`);
    continue;
  }
  
  const key = crypto.createHash("sha1").update(rel).digest("hex").slice(0, 12);
  let newInFile = 0;

  const url = text.match(/^Источник:\s*(https?:\/\/\S+)/)?.[1];
  const pageTitle = text.match(/^Заголовок:\s*(.+)$/m)?.[1]?.trim();

  chunks.forEach((t, i) => {
    const id = `${key}-${i}`;
    const chunkBody = pageTitle && i > 0 ? `[${pageTitle}]\n${t}` : t;
    const contentHash = hashText(chunkBody);

    if (cache[id] === contentHash) {
      skippedCount++;
      return;
    }

    pending.push({ id, text: chunkBody, source: url || rel, contentHash });
    newInFile++;
  });

  if (newInFile > 0) {
    console.log(`• ${rel} — новых/изменённых: ${newInFile} (всего в файле: ${chunks.length})`);
  }
}

if ( skippedCount > 0 ) {
  console.log(`Пропущено (уже есть в кэше): ${skippedCount} фрагм.`);
}

if (!pending.length) {
  console.log("Нечего загружать: все фрагменты уже в базе.");
  process.exit(0);
}


if (SYNC_ONLY) {
  pending.forEach((p) => {
    cache[p.id] = p.contentHash;
  });
  await saveCache(cache);
  console.log(`Готово (--sync-only): ${pending.length} фрагментов помечены как загруженные в .ingest-cache.json.`);
  process.exit(0);
}

console.log(`Всего новых фрагментов: ${pending.length}. Считаю эмбеддинги…`);
const store = await getStore({ createIfMissing: true });

const BATCH = 20;           
const PAUSE_MS = 15_000;    

for (let i = 0; i < pending.length; i += BATCH) {
  const part = pending.slice(i, i + BATCH);
  const vectors = await embed(part.map((p) => p.text), "RETRIEVAL_DOCUMENT");

  const records = part.map((p, k) => ({
    id: p.id,
    text: p.text,
    source: p.source,
    values: vectors[k],
  }));

  await store.upsert(records);

  part.forEach((p) => {
    cache[p.id] = p.contentHash;
  });
  await saveCache(cache);

  console.log(`  ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
  if (i + BATCH < pending.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
}

console.log(`Готово: ${pending.length} фрагментов загружено в ${vectorProvider}.`);