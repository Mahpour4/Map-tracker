/*
 * Shared utilities for Map Tracker Viewer
 * Auth, data fetching, CSV parsing, nav bar, common UI
 */

// --- Config ---
const REPO_OWNER = "Mahpour4";
const REPO_NAME = "Map-tracker";
const BRANCH = "claude/map-stores-zones-zcvTK"; // change if your default branch differs
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// --- PIN Hashing ---
async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- Auth ---
function getSession() {
  try {
    const raw = sessionStorage.getItem("viewer_session");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(user) {
  sessionStorage.setItem("viewer_session", JSON.stringify({ name: user.name, pages: user.pages }));
}

function clearSession() {
  sessionStorage.removeItem("viewer_session");
}

function logout() {
  clearSession();
  window.location.href = "index.html";
}

async function authenticate(pin) {
  const hash = await hashPin(pin);
  const user = USERS.find(u => u.pinHash === hash);
  if (user) {
    setSession(user);
    return user;
  }
  return null;
}

function requireAuth(page) {
  const session = getSession();
  if (!session) { window.location.href = "index.html"; return null; }
  if (page && !session.pages.includes(page)) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

// --- Data Fetching ---
function rawUrl(filePath) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${filePath}`;
}

async function fetchData(filePath, bustCache) {
  const cacheKey = `cache_${filePath}`;
  const tsKey = `cache_ts_${filePath}`;
  if (!bustCache) {
    const cached = sessionStorage.getItem(cacheKey);
    const ts = sessionStorage.getItem(tsKey);
    if (cached && ts && Date.now() - Number(ts) < CACHE_TTL) {
      return JSON.parse(cached);
    }
  }
  const url = rawUrl(filePath);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${filePath}: ${resp.status}`);
  const text = await resp.text();
  let data;
  if (filePath.endsWith(".json")) {
    data = JSON.parse(text);
  } else {
    data = text;
  }
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(data));
    sessionStorage.setItem(tsKey, String(Date.now()));
  } catch { /* sessionStorage full, skip cache */ }
  return data;
}

// --- CSV Parser ---
function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { vals.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    vals.push(current.trim());
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] || ""; });
    return obj;
  });
}

// --- Nav Bar ---
function renderNav(activePage) {
  const session = getSession();
  if (!session) return "";

  const allPages = [
    { id: "orders", label: "Orders", icon: "📦" },
    { id: "inventory", label: "Inventory", icon: "📊" },
    { id: "schedule", label: "Schedule", icon: "📅" },
    { id: "visits", label: "Visits", icon: "🏪" },
    { id: "map", label: "Map", icon: "🗺️" },
  ];

  const links = allPages
    .filter(p => session.pages.includes(p.id))
    .map(p => {
      const active = p.id === activePage ? ' class="active"' : "";
      return `<a href="${p.id}.html"${active}>${p.icon} ${p.label}</a>`;
    })
    .join("");

  return `
    <nav id="nav">
      <div class="nav-left">
        <a href="index.html" class="nav-brand">Map Tracker</a>
        ${links}
      </div>
      <div class="nav-right">
        <span class="nav-user">${session.name}</span>
        <button onclick="logout()" class="nav-logout">Logout</button>
      </div>
    </nav>
  `;
}

function injectNav(activePage) {
  const nav = renderNav(activePage);
  if (nav) {
    document.body.insertAdjacentHTML("afterbegin", nav);
  }
}

// --- UI Helpers ---
function el(tag, attrs, children) {
  const elem = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === "className") elem.className = v;
    else if (k === "onclick") elem.onclick = v;
    else if (k === "innerHTML") elem.innerHTML = v;
    else elem.setAttribute(k, v);
  });
  if (typeof children === "string") elem.textContent = children;
  else if (Array.isArray(children)) children.forEach(c => { if (c) elem.appendChild(c); });
  else if (children instanceof HTMLElement) elem.appendChild(children);
  return elem;
}

function summaryCard(label, value, color) {
  return `<div class="summary-card">
    <div class="summary-value" style="color:${color || '#fff'}">${value}</div>
    <div class="summary-label">${label}</div>
  </div>`;
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(n) {
  const num = parseFloat(n);
  if (isNaN(num)) return n || "—";
  return "$" + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d)) return Infinity;
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

function showLoading(containerId) {
  const c = document.getElementById(containerId);
  if (c) c.innerHTML = '<div class="loading-spinner">Loading data...</div>';
}

function showError(containerId, msg) {
  const c = document.getElementById(containerId);
  if (c) c.innerHTML = `<div class="error-msg">${msg}</div>`;
}
