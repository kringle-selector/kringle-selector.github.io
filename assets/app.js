"use strict";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loginScreen  = document.getElementById("login-screen");
const mainScreen   = document.getElementById("main-screen");
const loginForm    = document.getElementById("login-form");
const passwordEl   = document.getElementById("password");
const togglePwBtn  = document.getElementById("toggle-pw");
const submitBtn    = document.getElementById("submit-btn");
const errorMsg     = document.getElementById("error-msg");
const loadingMsg   = document.getElementById("loading-msg");
const userNameEl   = document.getElementById("user-name");
const spinView     = document.getElementById("spin-view");
const spinBtn      = document.getElementById("spin-btn");
const wheelEl      = document.getElementById("wheel");
const resultView   = document.getElementById("result-view");
const resultLead   = document.getElementById("result-lead");
const revealBtn    = document.getElementById("reveal-btn");
const resultCard   = document.getElementById("result-card");
const resultName   = document.getElementById("result-name");
const resultNote   = document.getElementById("result-note");
const logoutBtn    = document.getElementById("logout-btn");
const yearEl       = document.getElementById("year");

// ── Constants ─────────────────────────────────────────────────────────────────
const SEG_COLORS   = ["#c0392b", "#1e6b52", "#e74c3c", "#146c43"];
const STORAGE_KEY  = "kringle_reveals_v1";

// ── State ─────────────────────────────────────────────────────────────────────
let participants    = new Map(); // password (lower) → name
let assignments     = new Map(); // giver → receiver
let wheelNames      = [];        // ordered givers from assignments.csv
let seedRevealed    = new Map(); // name → receiver (CSV seed)
let currentUser     = null;
let currentWheelNames = [];
let spinning        = false;

// ── Year ──────────────────────────────────────────────────────────────────────
yearEl.textContent = new Date().getFullYear();

// ── localStorage helpers ──────────────────────────────────────────────────────
const readStore = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
};

function getRevealed(name) {
  const s = readStore();
  if (s[name] && s[name].receiver) return s[name].receiver;
  if (seedRevealed.has(name)) return seedRevealed.get(name);
  return null;
}

function markRevealed(name, receiver) {
  const s = readStore();
  s[name] = { receiver, at: new Date().toISOString() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { console.warn(e); }
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const row = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        // quoted field
        i++; // skip opening quote
        let field = "";
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            field += '"'; i += 2;
          } else if (line[i] === '"') {
            i++; break;
          } else {
            field += line[i++];
          }
        }
        row.push(field);
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) { row.push(line.slice(i)); break; }
        row.push(line.slice(i, end));
        i = end + 1;
      }
    }
    rows.push(row);
  }
  return rows;
}

async function fetchRows(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const rows = parseCSV(await res.text());
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  return { header, rows };
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  const [pResult, aResult, rResult] = await Promise.all([
    fetchRows("data/participants.csv"),
    fetchRows("data/assignments.csv"),
    fetchRows("data/reveal_status.csv").catch(() => null),
  ]);

  // participants: password (lower) → name
  const pi = pResult.header.indexOf("name");
  const pw = pResult.header.indexOf("password");
  for (const row of pResult.rows) {
    if (row[pi] && row[pw]) {
      participants.set(row[pw].trim().toLowerCase(), row[pi].trim());
    }
  }

  // assignments: giver → receiver; wheelNames = ordered givers
  const gi = aResult.header.indexOf("giver");
  const ri = aResult.header.indexOf("receiver");
  for (const row of aResult.rows) {
    if (row[gi] && row[ri]) {
      assignments.set(row[gi].trim(), row[ri].trim());
      wheelNames.push(row[gi].trim());
    }
  }

  // reveal_status seed
  if (rResult) {
    const ni  = rResult.header.indexOf("name");
    const hri = rResult.header.indexOf("has_revealed");
    const rri = rResult.header.indexOf("revealed_receiver");
    for (const row of rResult.rows) {
      const name = row[ni] && row[ni].trim();
      const flag = row[hri] && row[hri].trim().toLowerCase();
      if (name && ["yes","true","1"].includes(flag)) {
        const recv = rri >= 0 ? (row[rri] || "").trim() : "";
        if (recv) seedRevealed.set(name, recv);
      }
    }
  }
}

const ready = loadData().catch((err) => {
  console.error(err);
  showError("Couldn't reach the database… run it through a local server or GitHub Pages.");
  submitBtn.disabled = true;
});

// ── Password toggle ───────────────────────────────────────────────────────────
togglePwBtn.addEventListener("click", () => {
  const show = passwordEl.type === "password";
  passwordEl.type = show ? "text" : "password";
  togglePwBtn.textContent = show ? "🙈" : "👁️";
  togglePwBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

// ── Login ─────────────────────────────────────────────────────────────────────
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  loadingMsg.hidden = false;
  submitBtn.disabled = true;

  try {
    await ready;
  } catch {
    loadingMsg.hidden = true;
    submitBtn.disabled = false;
    return;
  }

  loadingMsg.hidden = true;
  submitBtn.disabled = false;

  const pw = passwordEl.value.trim().toLowerCase();
  const name = participants.get(pw);

  if (!name) {
    showError("That password isn't on the nice list. Try again! 🎅");
    passwordEl.select();
    return;
  }

  enterMain(name);
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}
function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = "";
}

// ── Main screen ───────────────────────────────────────────────────────────────
function enterMain(name) {
  currentUser = name;
  userNameEl.textContent = name;

  loginScreen.hidden = true;
  mainScreen.hidden = false;

  spinView.hidden = true;
  resultView.hidden = true;

  const revealed = getRevealed(name);

  if (revealed) {
    // returning user — skip wheel
    showResult(revealed, false);
  } else {
    // first time — build wheel and show spin view
    currentWheelNames = wheelNames.filter((n) => n !== name);
    buildWheel(currentWheelNames);
    spinView.hidden = false;
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
logoutBtn.addEventListener("click", () => {
  currentUser = null;
  spinning = false;
  spinBtn.disabled = false;
  passwordEl.value = "";
  clearError();
  mainScreen.hidden = true;
  loginScreen.hidden = false;
});

// ── Wheel builder ─────────────────────────────────────────────────────────────
function buildWheel(names) {
  const seg = 360 / names.length;
  const stops = names
    .map((_, i) => `${SEG_COLORS[i % SEG_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`)
    .join(", ");
  wheelEl.style.transition = "none";
  wheelEl.style.transform = "rotate(0deg)";
  wheelEl.style.background = `conic-gradient(from 0deg, ${stops})`;
  wheelEl.innerHTML = "";
  names.forEach((name, i) => {
    const center = i * seg + seg / 2;
    const label = document.createElement("div");
    label.className = "wheel-label";
    label.style.transform = `rotate(${center}deg)`;
    const span = document.createElement("span");
    span.textContent = name;
    span.style.transform = `translateX(-50%) rotate(${-center}deg)`;
    label.appendChild(span);
    wheelEl.appendChild(label);
  });
  wheelEl._seg = seg;
}

// ── Spin ──────────────────────────────────────────────────────────────────────
spinBtn.addEventListener("click", spin);

function spin() {
  if (spinning || !currentUser) return;
  const receiver = assignments.get(currentUser);
  const idx = currentWheelNames.indexOf(receiver);
  if (idx < 0) return;
  spinning = true;
  spinBtn.disabled = true;

  const seg = wheelEl._seg;
  const center = idx * seg + seg / 2;
  const jitter = (Math.random() - 0.5) * (seg - 12);
  const turns = 6 + Math.floor(Math.random() * 3);
  const finalRotation = turns * 360 + (360 - center) + jitter;

  requestAnimationFrame(() => {
    wheelEl.style.transition = "transform 5.2s cubic-bezier(0.16, 0.68, 0.12, 0.99)";
    wheelEl.style.transform = `rotate(${finalRotation}deg)`;
  });

  wheelEl.addEventListener("transitionend", () => {
    markRevealed(currentUser, receiver);
    spinning = false;
    showResult(receiver, true);
  }, { once: true });
}

// ── Show result ───────────────────────────────────────────────────────────────
function showResult(receiver, firstTime) {
  spinView.hidden = true;
  resultView.hidden = false;
  resultName.textContent = receiver;

  if (firstTime) {
    resultLead.textContent = "🎉 The wheel has spoken! You're the Secret Santa for…";
    revealBtn.hidden = true;
    resultCard.hidden = false;
    resultNote.hidden = false;
  } else {
    resultLead.textContent = "You've already spun the wheel. 🎡";
    revealBtn.hidden = false;
    resultCard.hidden = true;
    resultNote.hidden = true;

    revealBtn.addEventListener("click", () => {
      resultLead.textContent = "Welcome back! You're still the Secret Santa for…";
      revealBtn.hidden = true;
      resultCard.hidden = false;
      resultNote.hidden = false;
    }, { once: true });
  }
}
