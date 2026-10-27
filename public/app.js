/* mospolyt.ai — кольцо-спираль, интерактивные виджеты и чат. */

const API_URL = "/api/chat";
const STREAM_URL = "/api/chat/stream"; // потоковый ответ; поставьте null, чтобы получать ответ целиком

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

/* ================= Кольцо → спираль (плавная отрисовка без мигания) ================= */
const rings = [...document.querySelectorAll("[data-ring]")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let spiral = 0;          // текущая степень превращения 0..1
let spiralTarget = 0;    // куда стремимся
let rot = -Math.PI / 2;  // поворот
let speed = 0.004;

function cssColor(name) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  const n = parseInt(v.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return a.map((x, i) => Math.round(x + (b[i] - x) * k));
}

function drawRing(canvas, t, rotation, ink, bg) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth * dpr;
  if (!size) return;
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const c = size / 2;
  const R = size * 0.40;
  const lw = size * parseFloat(canvas.dataset.width || 0.17) * (1 - 0.25 * t);
  const turns = 2, steps = 240;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";

  for (let i = 0; i < steps; i++) {
    const u0 = i / steps, u1 = (i + 1) / steps;
    const a0 = u0 * turns * Math.PI * 2 + rotation;
    const a1 = u1 * turns * Math.PI * 2 + rotation;
    const r0 = R * (1 + (0.25 + 0.75 * u0 - 1) * t);
    const r1 = R * (1 + (0.25 + 0.75 * u1 - 1) * t);

    // Базовый ч/б градиент
    const ang = (u0 * turns * Math.PI * 2) % (Math.PI * 2);
    const ringV = 0.5 - 0.5 * Math.cos(ang);
    const v = ringV + (u0 - ringV) * t;
    let color = mix(ink, bg, v);

    ctx.strokeStyle = `rgb(${color.join(",")})`;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0);
    ctx.lineTo(c + Math.cos(a1) * r1, c + Math.sin(a1) * r1);
    ctx.stroke();
  }
}

function frame() {
  const ink = cssColor("--ink"), bg = cssColor("--bg");
  rings.forEach((cv) => drawRing(cv, spiral, rot, ink, bg));
}
function loop() {
  spiral += (spiralTarget - spiral) * 0.06;
  speed += ((spiralTarget ? 0.018 : 0.004) - speed) * 0.05;
  rot += speed;
  frame();
  requestAnimationFrame(loop);
}
function setThinking(on) {
  spiralTarget = on ? 1 : 0;
  if (reduceMotion) { spiral = spiralTarget; frame(); }
}
if (reduceMotion) frame(); else requestAnimationFrame(loop);

// По наведению на большое кольцо — плавно превращается в спираль и слегка наклоняется за курсором
const hero = $("#heroRing");
let thinking = false;
hero.addEventListener("pointerenter", () => { if (!thinking) spiralTarget = 1; });
hero.addEventListener("pointermove", (e) => {
  if (reduceMotion) return;
  const rect = hero.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  hero.style.transform = `rotateX(${(-ny * 10).toFixed(1)}deg) rotateY(${(nx * 10).toFixed(1)}deg)`;
});
hero.addEventListener("pointerleave", () => {
  if (!thinking) spiralTarget = 0;
  hero.style.transform = "";
});
hero.addEventListener("click", () => {
  if (!thinking) {
    spiralTarget = spiralTarget ? 0 : 1;
    if (reduceMotion) setThinking(!!spiralTarget);
  }
});

// Мягкая подсветка карточек при наведении
document.querySelectorAll("[data-spotlight]").forEach((card) => {
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});

/* ================= Интерактивный навигатор корпусов (слева под кольцом) ================= */
const CAMPUSES = {
  bs: {
    title: "Большая Семёновская, 38",
    metro: "м. Электрозаводская / Семёновская",
    desc: "Главный корпус, приёмная комиссия, МФЦ, коворкинги и основные потоковые аудитории.",
    ask: "Расскажи про корпус на Большой Семёновской: что там находится и как добраться?",
  },
  pk: {
    title: "Прянишникова, 2А",
    metro: "м. Коптево / Петровско-Разумовская",
    desc: "Издательское дело, дизайн, ИТ-направления, просторные лаборатории и медиацентр.",
    ask: "Расскажи про корпус на Прянишникова, 2А: какие факультеты там учатся?",
  },
  av: {
    title: "Автозаводская, 16",
    metro: "м. Автозаводская",
    desc: "Инженерные направления, транспорт, робототехника, научные лаборатории и мастерские.",
    ask: "Расскажи про корпус на Автозаводской, 16 и как туда добраться",
  },
  pr: {
    title: "Павла Корчагина, 22",
    metro: "м. ВДНХ / Ростокино",
    desc: "Гуманитарные и экономические направления, техносферная безопасность и спортивный комплекс.",
    ask: "Расскажи про корпус на Павла Корчагина, 22",
  },
  mh: {
    title: "Михалковская, 7",
    metro: "м. Коптево",
    desc: "Творческие мастерские, графика, искусство книги и выставочные пространства.",
    ask: "Расскажи про корпус на Михалковской, 7",
  },
};

const campusBody = $("#campusBody");
const campusTitle = $("#campusTitle");
const campusMetro = $("#campusMetro");
const campusDesc = $("#campusDesc");
const campusAskBtn = $("#campusAskBtn");

document.querySelectorAll(".campus-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const info = CAMPUSES[tab.dataset.campus];
    if (!info) return;
    document.querySelectorAll(".campus-tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    campusBody.style.animation = "none";
    void campusBody.offsetWidth;
    campusBody.style.animation = "";
    campusTitle.textContent = info.title;
    campusMetro.textContent = info.metro;
    campusDesc.textContent = info.desc;
    campusAskBtn.dataset.ask = info.ask;
  });
});

/* Чек-лист отображается как статический список. */

/* ================= Форматирование текста ответов ================= */
const escapeHtml = (s) =>
  String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function formatInline(str) {
  return str
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,!?:;)]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderText(raw) {
  const safe = escapeHtml(raw);
  const lines = safe.split(/\r?\n/);
  let html = "";
  let inUl = false, inOl = false;

  const closeLists = () => {
    if (inUl) { html += "</ul>"; inUl = false; }
    if (inOl) { html += "</ol>"; inOl = false; }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeLists(); continue; }

    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      closeLists();
      html += `<h3>${formatInline(hMatch[2])}</h3>`;
      continue;
    }
    const ulMatch = line.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      if (inOl) { html += "</ol>"; inOl = false; }
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += `<li>${formatInline(ulMatch[1])}</li>`;
      continue;
    }
    const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (!inOl) { html += "<ol>"; inOl = true; }
      html += `<li>${formatInline(olMatch[1])}</li>`;
      continue;
    }
    closeLists();
    html += `<p>${formatInline(line)}</p>`;
  }
  closeLists();
  return `<div class="msg-body">${html}</div>`;
}

/* ================= Чат ================= */
const SUGGESTIONS = [
  "Какие документы нужны для поступления?",
  "Как найти расписание занятий?",
  "Как получить место в общежитии?",
  "Как заказать справку об обучении?",
];
const GREETING = "Привет! Я ассистент, которого сделали студенты Политеха. Спрашивай про поступление, учёбу, расписание и студенческую жизнь.";

const DEMO_REPLIES = [
  { test: /поступ|документ|абитури|приём|прием/i,
    text: "**Поступление.** Здесь ассистент расскажет про этапы приёма, документы и сроки подачи. Точные даты и список документов смотри на официальном сайте и уточняй в приёмной комиссии." },
  { test: /расписан|пар[аы]|аудитори|корпус|семёнов|пряниш|автозавод|корчаг|михалк/i,
    text: "**Расписание и корпуса.** Подскажу, где смотреть расписание твоей группы, и помогу найти корпус, аудиторию или преподавателя. Напиши свою группу или курс." },
  { test: /общежит|заселен/i,
    text: "**Общежития.** Здесь будет порядок заселения, документы и правила проживания. Напиши, ты поступаешь или уже учишься, — подскажу, с чего начать." },
  { test: /справк|заявлен/i,
    text: "**Справки.** Объясню, как заказать справку об обучении и куда идти за другими документами. Напиши, какая именно справка нужна." },
  { test: /сессия|экзамен|зач[её]т|подготов|учёб|учеб/i,
    text: "**Учёба.** Могу составить план подготовки к сессии и объяснить сложную тему. Напиши предмет и дату экзамена." },
  { test: /сообществ|кружк|мероприят|спорт|студенч/i,
    text: "**Студенческая жизнь.** Здесь будут сообщества, мероприятия и спортивные секции. Напиши, что тебе интересно: наука, спорт, творчество или проекты." },
];
const FALLBACK = "Это демо-режим: настоящие ответы появятся, когда ассистент подключится к серверу. Попробуй спросить про поступление, расписание, общежитие или справки.";

const log = $("#log"), form = $("#form"), input = $("#input");
const chips = $("#chips"), sendBtn = $("#sendBtn"), scrollBottomBtn = $("#scrollBottomBtn");
let history = loadHistory();
let busy = false;
let abortCtrl = null;

function loadHistory() { try { return JSON.parse(localStorage.getItem("mospolyt-chat") || "[]"); } catch { return []; } }
function saveHistory() { try { localStorage.setItem("mospolyt-chat", JSON.stringify(history.slice(-40))); } catch {} }

function isNearBottom() {
  return log.scrollHeight - log.scrollTop - log.clientHeight < 90;
}
function smartScroll(force = false) {
  if (force || isNearBottom()) log.scrollTop = log.scrollHeight;
}
log.addEventListener("scroll", () => {
  if (scrollBottomBtn) scrollBottomBtn.hidden = isNearBottom();
});
scrollBottomBtn?.addEventListener("click", () => smartScroll(true));

function createCopyButton(getRawText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.title = "Скопировать ответ";
  btn.setAttribute("aria-label", "Скопировать ответ");
  const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
  btn.innerHTML = copyIcon;

  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getRawText());
      btn.innerHTML = checkIcon;
      btn.classList.add("copied");
      setTimeout(() => { btn.innerHTML = copyIcon; btn.classList.remove("copied"); }, 1500);
    } catch {}
  });
  return btn;
}

function addMessage(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role;
  let rawText = text;

  if (role === "bot") {
    el.innerHTML = renderText(text);
    el.appendChild(createCopyButton(() => rawText));
    el._updateText = (newText) => {
      rawText = newText;
      const body = el.querySelector(".msg-body");
      if (body) body.outerHTML = renderText(newText);
    };
  } else {
    el.textContent = text;
  }

  log.appendChild(el);
  smartScroll(true);
  return el;
}

function showTyping() {
  const el = document.createElement("div");
  el.className = "msg bot";
  el.innerHTML = '<span class="typing" aria-label="Ассистент печатает"><i></i><i></i><i></i></span>';
  log.appendChild(el);
  smartScroll(true);
  return el;
}

function renderChips() {
  chips.innerHTML = "";
  if (history.length > 1) return;
  SUGGESTIONS.forEach((q) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = q;
    b.addEventListener("click", () => send(q));
    chips.appendChild(b);
  });
}

async function askAssistant(message, signal) {
  if (API_URL) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
      signal,
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return (await res.json()).reply;
  }
  await new Promise((r) => setTimeout(r, 1200 + Math.random() * 600));
  const hit = DEMO_REPLIES.find((r) => r.test.test(message));
  return hit ? hit.text : FALLBACK;
}

// Потоковый ответ: текст появляется по мере генерации (сервер шлёт NDJSON-строки)
async function askStream(message, typing, signal) {
  const res = await fetch(STREAM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error("HTTP " + res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "", el = null;

  const handle = (line) => {
    line = line.trim();
    if (!line) return;
    const m = JSON.parse(line);
    if (m.error) { const e = new Error(m.error); e.userMessage = m.error; throw e; }
    if (m.s && !el) {
      let note = typing.querySelector(".typing-note");
      if (!note) { note = document.createElement("span"); note.className = "typing-note"; typing.appendChild(note); }
      note.textContent = m.s;
    }
    if (m.t) {
      if (!el) { typing.remove(); el = addMessage("bot", ""); }
      full += m.t;
      el._updateText(full);
      smartScroll(false);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    handle(buf);
  } catch (err) {
    if (err.name === "AbortError" && full) return full;
    throw err;
  }
  return full;
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;

  abortCtrl = new AbortController();
  busy = true; thinking = true;
  sendBtn.classList.add("is-busy");
  setThinking(true);

  addMessage("user", text);
  history.push({ role: "user", content: text });
  renderChips();
  input.value = ""; autoGrow();

  const typing = showTyping();
  try {
    let reply;
    if (STREAM_URL) {
      reply = await askStream(text, typing, abortCtrl.signal);
      typing.remove();
    } else {
      reply = await askAssistant(text, abortCtrl.signal);
      typing.remove();
      addMessage("bot", reply);
    }
    if (reply) history.push({ role: "assistant", content: reply });
  } catch (e) {
    typing.remove();
    if (e.name !== "AbortError") {
      addMessage("bot", e?.userMessage || "Не получилось получить ответ. Проверь соединение и попробуй ещё раз.");
    }
  }
  saveHistory();
  busy = false; thinking = false; abortCtrl = null;
  sendBtn.classList.remove("is-busy");
  setThinking(false);
  input.focus();
}

function resetChat() {
  if (abortCtrl) abortCtrl.abort();
  history = [{ role: "assistant", content: GREETING }];
  log.innerHTML = "";
  addMessage("bot", GREETING);
  saveHistory(); renderChips();
}

function autoGrow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}
input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!busy) send(input.value);
  }
});
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy && abortCtrl) abortCtrl.abort();
  else send(input.value);
});
$("#clearBtn").addEventListener("click", resetChat);

document.querySelectorAll("[data-ask]").forEach((btn) =>
  btn.addEventListener("click", () => {
    $("#chat").scrollIntoView({ behavior: "smooth", block: "center" });
    send(btn.dataset.ask);
  })
);

/* ================= Тема ================= */
let theme = "light";
try { theme = localStorage.getItem("mospolyt-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch {}
root.dataset.theme = theme;
$("#themeToggle").addEventListener("click", () => {
  theme = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = theme;
  try { localStorage.setItem("mospolyt-theme", theme); } catch {}
  if (reduceMotion) frame();
});

/* ================= Старт ================= */
if (history.length === 0) resetChat();
else { history.forEach((m) => addMessage(m.role === "user" ? "user" : "bot", m.content)); renderChips(); }
$("#statusText").textContent = API_URL ? "онлайн" : "демо-режим";