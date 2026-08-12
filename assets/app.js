"use strict";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase, ref, get, set,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";


// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  databaseURL: "https://kringle-selector-default-rtdb.firebaseio.com",
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

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
const SEG_COLORS = ["#c0392b", "#1e6b52", "#e74c3c", "#146c43"];
// RTDB keys can't contain these characters; a password with any of them can't be
// a valid key, so we treat it as "no such password" rather than crashing ref().
const BAD_KEY_CHARS = /[.$#[\]/]/;

// ── State ─────────────────────────────────────────────────────────────────────
let wheelNames        = [];   // all participant names (for the wheel segments)
let currentUser       = null; // logged-in person's name
let currentPw         = null; // their password (the RTDB key)
let currentReceiver   = null; // who they're gifting
let currentWheelNames = [];   // wheelNames minus the current user
let spinning          = false;

// ── Year ──────────────────────────────────────────────────────────────────────
yearEl.textContent = new Date().getFullYear();

// ── Time helper ───────────────────────────────────────────────────────────────
// Reveal timestamps are stored as a readable Eastern-time string (DST-aware:
// shows EDT in summer, EST in winter). Kept a string to satisfy the RTDB rules.
function nowEastern() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true, timeZoneName: "short",
  });
}

// ── Data loading ──────────────────────────────────────────────────────────────
// Only /names is fetched up front (it's public). Assignments live under
// /secrets/{password} and are read one-at-a-time at login, so no browser ever
// downloads more than the logged-in user's own match.
async function loadNames() {
  const snap = await get(ref(db, "names"));
  const val = snap.val();
  // Firebase returns an array for sequential integer keys, or an object if sparse.
  wheelNames = (Array.isArray(val) ? val : Object.values(val || {})).filter(Boolean);
  if (wheelNames.length === 0) throw new Error("No names in database");
}

const ready = loadNames().catch((err) => {
  console.error(err);
  showError("Couldn't reach the database. Check your connection and refresh. 🎄");
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

  const pw = passwordEl.value.trim().toLowerCase();

  let secret = null;
  if (pw && !BAD_KEY_CHARS.test(pw)) {
    try {
      secret = (await get(ref(db, `secrets/${pw}`))).val();
    } catch (err) {
      console.error(err);
      loadingMsg.hidden = true;
      submitBtn.disabled = false;
      showError("Couldn't reach the database. Try again in a moment. 🎄");
      return;
    }
  }

  loadingMsg.hidden = true;
  submitBtn.disabled = false;

  if (!secret || !secret.name || !secret.receiver) {
    showError("That password isn't on the nice list. Try again! 🎅");
    passwordEl.select();
    return;
  }

  currentPw       = pw;
  currentUser     = secret.name;
  currentReceiver = secret.receiver;
  await enterMain();
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
async function enterMain() {
  userNameEl.textContent = currentUser;

  loginScreen.hidden = true;
  mainScreen.hidden = false;
  spinView.hidden = true;
  resultView.hidden = true;

  // Already spun on any device? Skip the wheel.
  let revealed = null;
  try {
    revealed = (await get(ref(db, `reveals/${currentPw}`))).val();
  } catch (err) {
    console.warn("Could not read reveal status:", err);
  }

  if (revealed && revealed.receiver) {
    showResult(revealed.receiver, false);
  } else {
    currentWheelNames = wheelNames.filter((n) => n !== currentUser);
    buildWheel(currentWheelNames);
    spinView.hidden = false;
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
logoutBtn.addEventListener("click", () => {
  currentUser = null;
  currentPw = null;
  currentReceiver = null;
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
  const receiver = currentReceiver;
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

  wheelEl.addEventListener("transitionend", async () => {
    try {
      await set(ref(db, `reveals/${currentPw}`), {
        name: currentUser,
        receiver,
        at: nowEastern(),
      });
    } catch (err) {
      // Non-fatal: the reveal just won't persist across devices this time.
      console.warn("Could not save reveal to database:", err);
    }
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
