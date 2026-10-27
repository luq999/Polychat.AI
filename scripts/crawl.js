// Скачивает страницы сайтов из knowledge/sources.txt и сохраняет их текст в knowledge/web/*.md.
// Дальше обычный `npm run ingest` загрузит эти файлы в векторную базу вместе с остальными документами.
//
// Запуск:  npm run crawl
//          npm run crawl -- --depth 2 --max 60 --delay 800
//   --depth  на сколько переходов вглубь идти по ссылкам внутри сайта (0 = только указанные страницы), по умолчанию 1
//   --max    максимум страниц за запуск, по умолчанию 30
//   --delay  пауза между запросами, мс, по умолчанию 700 (чтобы не нагружать чужой сайт)
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcesFile = path.join(root, "knowledge", "sources.txt");
const outDir = path.join(root, "knowledge", "web");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf("--" + name);
  const v = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
};
const DEPTH = opt("depth", 1);
const MAX_PAGES = opt("max", 30);
const DELAY = opt("delay", 700);
const UA = "mospolyt-ai-student-bot/1.0 (student project)";
const SKIP_FILES = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|svg|webp|mp[34]|avi|css|js|ico|xml|json)(\?|$)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- robots.txt (простая проверка Disallow для User-agent: *) ---------- */
function parseRobots(text) {
  const rules = [];
  let applies = false, prevWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "user-agent") {
      if (!prevWasAgent) applies = false;
      if (val === "*") applies = true;
      prevWasAgent = true;
    } else {
      prevWasAgent = false;
      if (key === "disallow" && applies && val && !val.includes("*") && !val.includes("$")) rules.push(val);
    }
  }
  return rules;
}
const robotsCache = new Map();
async function allowed(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const r = await fetch(u.origin + "/robots.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) rules = parseRobots(await r.text());
    } catch {}
    robotsCache.set(u.origin, rules);
  }
  const target = u.pathname + u.search;
  return !robotsCache.get(u.origin).some((p) => target.startsWith(p));
}

/* ---------- HTML → текст ---------- */
const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…", copy: "©", minus: "−" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return " "; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });

function htmlToText(html) {
  const h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|select|button)\b[\s\S]*?<\/\1>/gi, "");
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim());
  const main = h.match(/<main\b[\s\S]*?<\/main>/i) || h.match(/<article\b[\s\S]*?<\/article>/i);
  let body = main ? main[0] : h.match(/<body\b[\s\S]*?<\/body>/i)?.[0] ?? h;
  if (!main) body = body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, "");
  body = body
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "— ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|ul|ol|table|blockquote|dd|dt)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const lines = decode(body)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter((l) => l.length >= 3);
  return { title, lines };
}

function extractLinks(html, base, hosts) {
  const out = new Set();
  for (const m of html.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      u.hash = "";
      if (!/^https?:$/.test(u.protocol) || !hosts.has(u.host) || SKIP_FILES.test(u.pathname + u.search)) continue;
      out.add(u.href);
    } catch {}
  }
  return [...out];
}

/* ---------- основной процесс ---------- */
let seedsText;
try {
  seedsText = await fs.readFile(sourcesFile, "utf8");
} catch {
  console.error("Нет файла knowledge/sources.txt. Создай его и впиши адреса страниц, по одному на строку.");
  process.exit(1);
}
const seeds = seedsText.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter((l) => /^https?:\/\//i.test(l));
if (!seeds.length) {
  console.error("В knowledge/sources.txt нет адресов (строки вида https://example.com/page).");
  process.exit(1);
}
const hosts = new Set(seeds.map((s) => new URL(s).host));

await fs.rm(outDir, { recursive: true, force: true }); // чистим результаты прошлого запуска
await fs.mkdir(outDir, { recursive: true });

const queue = seeds.map((url) => ({ url, depth: 0 }));
const visited = new Set();
const lineCount = new Map(); // повторяющиеся строки (меню, подвалы) отбрасываем
const seenPages = new Set();   // одинаковые по тексту страницы (например, / и /index.html) сохраняем один раз
let saved = 0;

while (queue.length && saved < MAX_PAGES) {
  const { url, depth } = queue.shift();
  if (visited.has(url)) continue;
  visited.add(url);

  try {
    if (!(await allowed(url))) { console.log(`✗ запрещено robots.txt: ${url}`); continue; }
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru,en;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { console.log(`✗ ${res.status}: ${url}`); continue; }
    if (!(res.headers.get("content-type") || "").includes("html")) { console.log(`✗ не HTML: ${url}`); continue; }
    const html = await res.text();
    const finalUrl = res.url || url;

    const { title, lines } = htmlToText(html);
    const kept = lines.filter((l) => {
      const c = (lineCount.get(l) || 0) + 1;
      lineCount.set(l, c);
      return l.length < 20 || c <= 2;
    });
    const text = kept.join("\n\n");

    const textHash = crypto.createHash("sha1").update(text).digest("hex");

    if (text.length >= 200 && seenPages.has(textHash)) {
      console.log(`– дубль: ${url}`);
    } else if (text.length < 200) {
      console.log(`✗ мало текста (возможно, страница строится на JavaScript): ${url}`);
    } else {
      const u = new URL(finalUrl);
      const slug = (u.host + u.pathname).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70);
      const hash = crypto.createHash("sha1").update(finalUrl).digest("hex").slice(0, 6);
      await fs.writeFile(path.join(outDir, `${slug}-${hash}.md`), `Источник: ${finalUrl}\nЗаголовок: ${title || finalUrl}\n\n${text}\n`, "utf8");
      seenPages.add(textHash);
      saved++;
      console.log(`• [${saved}] ${title || finalUrl} — ${text.length} симв.`);
    }

    if (depth < DEPTH) {
      for (const link of extractLinks(html, finalUrl, hosts)) if (!visited.has(link)) queue.push({ url: link, depth: depth + 1 });
    }
  } catch (err) {
    console.log(`✗ ошибка (${err?.cause?.code || err?.message}): ${url}`);
  }
  await sleep(DELAY);
}

console.log(`\nГотово: сохранено страниц — ${saved} (папка knowledge/web). Теперь выполни: npm run ingest`);
