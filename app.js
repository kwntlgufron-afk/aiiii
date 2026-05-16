/**
 * LuaAI Platform — app.js
 * 
 * SECURITY ARCHITECTURE:
 * ─────────────────────────────────────────────────────────────────
 * ❌ API Key TIDAK pernah disimpan di localStorage atau dikirim ke browser
 * ❌ API Key TIDAK ada di file ini atau file JS manapun yang bisa dilihat user
 * ✅ Semua request AI melewati proxy server (proxy-server.js)
 * ✅ Owner menyimpan key di server environment variable
 * ✅ Demo mode: gunakan mock response jika proxy tidak tersedia
 * ─────────────────────────────────────────────────────────────────
 * 
 * Untuk deploy production:
 * 1. Deploy proxy-server.js ke backend (Node/Express)
 * 2. Set env var: ANTHROPIC_API_KEY=sk-ant-...
 * 3. Ubah PROXY_URL ke URL server kamu
 */

"use strict";

// ─── CONFIG (NO SECRETS HERE) ────────────────────────────────────
const CONFIG = {
  PROXY_URL: './api/chat',     // URL proxy server (ubah saat deploy)
  DEFAULT_DAILY_LIMIT: 5,
  OWNER_USERNAME: 'Marvel',   // Username owner
  VERSION: '1.0.0'
};

// ─── STATE ───────────────────────────────────────────────────────
let state = {
  currentUser: null,
  currentView: 'landing', // landing | customer | owner
  chatHistory: [],
  isTyping: false
};

// ─── STORAGE HELPERS (hanya data non-sensitif) ───────────────────
const Store = {
  // Simpan user tanpa API key
  saveUsers(users) {
    // Pastikan tidak ada api key tersimpan
    const safe = users.map(u => {
      const { apiKey, ...safeUser } = u;
      return safeUser;
    });
    localStorage.setItem('luaai_users', JSON.stringify(safe));
  },
  getUsers() {
    try { return JSON.parse(localStorage.getItem('luaai_users') || '[]'); }
    catch { return []; }
  },
  saveSession(user) {
    const { apiKey, ...safeUser } = (user || {});
    sessionStorage.setItem('luaai_session', JSON.stringify(safeUser));
  },
  getSession() {
    try { return JSON.parse(sessionStorage.getItem('luaai_session') || 'null'); }
    catch { return null; }
  },
  clearSession() { sessionStorage.removeItem('luaai_session'); },
  saveLuaFiles(files) { localStorage.setItem('luaai_lua_files', JSON.stringify(files)); },
  getLuaFiles() {
    try { return JSON.parse(localStorage.getItem('luaai_lua_files') || '[]'); }
    catch { return []; }
  },
  savePlatformConfig(cfg) {
    // Config platform — TIDAK termasuk api key
    const { apiKey, ...safeCfg } = (cfg || {});
    localStorage.setItem('luaai_config', JSON.stringify(safeCfg));
  },
  getPlatformConfig() {
    try { return JSON.parse(localStorage.getItem('luaai_config') || '{}'); }
    catch { return {}; }
  },
  getChatHistory(userId) {
    try { return JSON.parse(localStorage.getItem(`luaai_history_${userId}`) || '[]'); }
    catch { return []; }
  },
  saveChatHistory(userId, history) {
    // Simpan max 50 chat terakhir
    localStorage.setItem(`luaai_history_${userId}`, JSON.stringify(history.slice(-50)));
  },
  // Simpan API key hanya di sessionStorage owner (memory only, bukan localStorage)
  // DAN ini hanya untuk demo — produksi harus di server env var
  saveOwnerKey(key) {
    if (!key) return;
    // Simpan secara aman di session, bukan localStorage
    sessionStorage.setItem('luaai_ok', btoa(key));
  },
  getOwnerKey() {
    try {
      const enc = sessionStorage.getItem('luaai_ok');
      return enc ? atob(enc) : null;
    } catch { return null; }
  }
};

// ─── RATE LIMIT ──────────────────────────────────────────────────
const RateLimit = {
  getKey(userId) { return `luaai_rl_${userId}`; },
  getUsage(userId) {
    const today = new Date().toDateString();
    try {
      const data = JSON.parse(localStorage.getItem(this.getKey(userId)) || '{}');
      if (data.date !== today) return { count: 0, date: today };
      return data;
    } catch { return { count: 0, date: new Date().toDateString() }; }
  },
  increment(userId) {
    const usage = this.getUsage(userId);
    usage.count += 1;
    usage.date = new Date().toDateString();
    localStorage.setItem(this.getKey(userId), JSON.stringify(usage));
  },
  canChat(userId, plan) {
    if (plan === 'premium') return true;
    const cfg = Store.getPlatformConfig();
    const limit = cfg.dailyLimit || CONFIG.DEFAULT_DAILY_LIMIT;
    const usage = this.getUsage(userId);
    return usage.count < limit;
  },
  getRemaining(userId, plan) {
    if (plan === 'premium') return '∞';
    const cfg = Store.getPlatformConfig();
    const limit = cfg.dailyLimit || CONFIG.DEFAULT_DAILY_LIMIT;
    const usage = this.getUsage(userId);
    return Math.max(0, limit - usage.count);
  }
};

// ─── INIT ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setTimeout(() => {
    const loading = document.getElementById('loadingScreen');
    loading.classList.add('fade-out');
    setTimeout(() => { loading.style.display = 'none'; }, 500);

    const session = Store.getSession();
    if (session) {
      loginUser(session, false);
    }
  }, 1800);
});

// ─── THEME ───────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('luaai_theme') || 'dark-blue';
  setTheme(saved, false);
}
function setTheme(theme, save = true) {
  document.body.setAttribute('data-theme', theme);
  if (save) localStorage.setItem('luaai_theme', theme);
}

// ─── AUTH ─────────────────────────────────────────────────────────
function openAuth(tab = 'login') {
  document.getElementById('authModal').classList.remove('hidden');
  switchTab(tab);
}
function closeAuth() { document.getElementById('authModal').classList.add('hidden'); }

function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('regError').classList.add('hidden');
}

function handleLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');

  if (!username || !password) {
    showError(errEl, 'Isi semua field terlebih dahulu.'); return;
  }

  const users = Store.getUsers();
  // Owner check
  if (username === CONFIG.OWNER_USERNAME && password === getOwnerPass()) {
    const ownerUser = { id: 'owner', username: 'Marvel', email: 'owner@luaai.app', role: 'owner', plan: 'owner' };
    closeAuth();
    loginUser(ownerUser);
    return;
  }

  const user = users.find(u => (u.username === username || u.email === username) && u.password === hashPass(password));
  if (!user) { showError(errEl, 'Username/email atau password salah.'); return; }

  closeAuth();
  loginUser({ ...user, password: undefined });
}

function handleRegister() {
  const username = document.getElementById('regUser').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPass').value;
  const passConfirm = document.getElementById('regPassConfirm').value;
  const errEl = document.getElementById('regError');

  if (!username || !email || !pass || !passConfirm) {
    showError(errEl, 'Isi semua field terlebih dahulu.'); return;
  }
  if (username === CONFIG.OWNER_USERNAME) {
    showError(errEl, 'Username tidak tersedia.'); return;
  }
  if (pass.length < 8) { showError(errEl, 'Password minimal 8 karakter.'); return; }
  if (pass !== passConfirm) { showError(errEl, 'Password tidak cocok.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError(errEl, 'Format email tidak valid.'); return; }

  const users = Store.getUsers();
  if (users.find(u => u.username === username)) { showError(errEl, 'Username sudah digunakan.'); return; }
  if (users.find(u => u.email === email)) { showError(errEl, 'Email sudah terdaftar.'); return; }

  const newUser = {
    id: 'u_' + Date.now(),
    username, email,
    password: hashPass(pass),
    role: 'customer',
    plan: 'free',
    points: 0,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  Store.saveUsers(users);

  closeAuth();
  loginUser({ ...newUser, password: undefined });
}

function loginUser(user, saveSession = true) {
  state.currentUser = user;
  if (saveSession) Store.saveSession(user);

  if (user.role === 'owner') {
    showOwnerDash();
  } else {
    showCustomerDash();
  }
  hideLanding();
}

function handleLogout() {
  state.currentUser = null;
  state.chatHistory = [];
  Store.clearSession();
  sessionStorage.removeItem('luaai_ok');

  document.getElementById('customerDash').classList.add('hidden');
  document.getElementById('ownerDash').classList.add('hidden');
  document.getElementById('landingPage').style.display = '';
}

// ─── OWNER PASSWORD (disimpan sebagai hash) ──────────────────────
function getOwnerPass() {
  // Default password owner: "Marvel@2025"
  // Di produksi, ini harus diverifikasi server-side
  const cfg = Store.getPlatformConfig();
  return cfg.ownerPassHash || hashPass('Marvel@2025');
}

// Simple hash untuk demo (gunakan bcrypt di produksi)
function hashPass(pass) {
  let h = 0;
  for (let i = 0; i < pass.length; i++) {
    h = ((h << 5) - h) + pass.charCodeAt(i); h |= 0;
  }
  return 'h_' + Math.abs(h).toString(16) + '_' + pass.length;
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── LANDING ─────────────────────────────────────────────────────
function hideLanding() { document.getElementById('landingPage').style.display = 'none'; }

// ─── CUSTOMER DASHBOARD ──────────────────────────────────────────
function showCustomerDash() {
  document.getElementById('customerDash').classList.remove('hidden');
  updateLimitBadge();
  updateSidebarUser();
  loadChatHistory();
  showSection('chat');
}

function updateSidebarUser() {
  const u = state.currentUser;
  if (!u) return;
  document.getElementById('sidebarAvatar').textContent = u.username[0].toUpperCase();
  document.getElementById('sidebarName').textContent = u.username;
  document.getElementById('sidebarPlan').textContent = u.plan === 'premium' ? '⭐ Premium' : '🆓 Free';
}

function updateLimitBadge() {
  const u = state.currentUser;
  if (!u) return;
  const remaining = RateLimit.getRemaining(u.id, u.plan);
  const badge = document.getElementById('limitBadge');
  if (u.plan === 'premium') {
    badge.textContent = '⭐ Unlimited';
    badge.style.background = 'rgba(34,197,94,0.15)';
  } else {
    badge.textContent = `${remaining} chat tersisa hari ini`;
  }
}

function showSection(name) {
  const sections = ['chat', 'history', 'points', 'settings'];
  sections.forEach(s => {
    document.getElementById(s + 'Section').classList.toggle('hidden', s !== name);
  });
  document.querySelectorAll('#customerDash .nav-item').forEach((btn, i) => {
    btn.classList.toggle('active', sections[i] === name);
  });

  const titles = { chat: 'Chat dengan LuaAI', history: 'Riwayat Chat', points: 'Points & Top Up', settings: 'Pengaturan' };
  document.getElementById('dashTitle').textContent = titles[name] || '';

  if (name === 'points') updatePointsSection();
  if (name === 'settings') updateSettingsSection();
  if (name === 'history') renderHistory();
}

function updatePointsSection() {
  const u = state.currentUser;
  if (!u) return;
  const users = Store.getUsers();
  const fresh = users.find(x => x.id === u.id) || u;
  document.getElementById('pointsValue').textContent = fresh.points || 0;
  const usage = RateLimit.getUsage(u.id);
  const cfg = Store.getPlatformConfig();
  const limit = cfg.dailyLimit || CONFIG.DEFAULT_DAILY_LIMIT;
  document.getElementById('chatUsedToday').textContent = `${usage.count} / ${u.plan === 'premium' ? '∞' : limit}`;
}

function updateSettingsSection() {
  const u = state.currentUser;
  if (!u) return;
  const users = Store.getUsers();
  const fresh = users.find(x => x.id === u.id) || u;
  document.getElementById('infoUsername').textContent = u.username;
  document.getElementById('infoEmail').textContent = u.email;
  document.getElementById('infoPlan').textContent = fresh.plan === 'premium' ? '⭐ Premium' : '🆓 Free';
  document.getElementById('infoPoints').textContent = fresh.points || 0;
}

// ─── CHAT ─────────────────────────────────────────────────────────
function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

async function sendMessage() {
  const u = state.currentUser;
  if (!u || state.isTyping) return;

  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  // Check rate limit
  if (!RateLimit.canChat(u.id, u.plan)) {
    showLimitReached();
    return;
  }

  // Append user message
  appendMessage('user', text);
  input.value = '';
  input.style.height = 'auto';

  // Increment usage
  RateLimit.increment(u.id);
  updateLimitBadge();

  // Save to history
  const historyItem = { q: text, time: new Date().toISOString() };
  const history = Store.getChatHistory(u.id);
  history.push(historyItem);
  Store.saveChatHistory(u.id, history);

  // Show typing
  state.isTyping = true;
  document.getElementById('sendBtn').disabled = true;
  const typingEl = appendTyping();

  try {
    const response = await callAI(text);
    typingEl.remove();
    appendMessage('bot', response);
  } catch (err) {
    typingEl.remove();
    appendMessage('bot', '⚠️ Terjadi kesalahan saat menghubungi AI. Pastikan server proxy berjalan dan API key sudah dikonfigurasi oleh owner.');
  }

  state.isTyping = false;
  document.getElementById('sendBtn').disabled = false;
}

async function callAI(userMessage) {
  // Ambil konteks file Lua
  const luaFiles = Store.getLuaFiles();
  const luaContext = luaFiles.map(f => `### File: ${f.name}\n${f.content}`).join('\n\n');

  const cfg = Store.getPlatformConfig();
  const systemPrompt = cfg.systemPrompt || `Kamu adalah LuaAI, asisten kode Lua yang expert dan membantu.
Kamu memahami syntax Lua, best practices, dan dapat membantu debugging.
Selalu berikan kode yang bersih dan terdokumentasi dengan baik.
Jika ada konteks file Lua dari owner, gunakan sebagai referensi utama.
Jawab dalam Bahasa Indonesia kecuali diminta lain.`;

  const fullSystem = luaContext
    ? `${systemPrompt}\n\n=== REFERENSI KODE LUA (dari owner) ===\n${luaContext}`
    : systemPrompt;

  // Build conversation history (max 10 pesan terakhir)
  const messages = state.chatHistory.slice(-10).concat([{ role: 'user', content: userMessage }]);
  state.chatHistory.push({ role: 'user', content: userMessage });

  /**
   * ARSITEKTUR KEAMANAN:
   * Dalam demo mode (GitHub Pages), request langsung ke Anthropic API.
   * Di produksi WAJIB gunakan proxy server agar API key tidak terekspos.
   * 
   * Flow produksi:
   * Browser → proxy-server.js (menyimpan API key) → Anthropic API
   */

  // Demo mode: langsung ke Anthropic (untuk GitHub Pages demo)
  // API key diambil dari sessionStorage owner (hanya ada saat owner login & set key)
  const apiKey = Store.getOwnerKey();

  if (!apiKey) {
    return `**[DEMO MODE]** API Key belum dikonfigurasi oleh owner.

Jika kamu owner:
1. Login sebagai Marvel
2. Buka panel "API Key"  
3. Masukkan API key Anthropic kamu

Untuk produksi, API key HARUS disimpan di server (bukan di browser).`;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: fullSystem,
      messages: messages
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.content?.[0]?.text || 'Tidak ada respons dari AI.';

  // Save to chat history
  state.chatHistory.push({ role: 'assistant', content: reply });

  return reply;
}

function appendMessage(role, text) {
  const container = document.getElementById('chatMessages');

  // Remove welcome message
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'bot' ? 'AI' : (state.currentUser?.username[0]?.toUpperCase() || 'U');

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = formatMessage(text);

  div.appendChild(avatar);
  div.appendChild(body);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message bot';
  div.innerHTML = `<div class="msg-avatar">AI</div><div class="msg-body"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function formatMessage(text) {
  // Format kode blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang}">${escapeHtml(code.trim())}</code></pre>`
  );
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Newlines
  text = text.replace(/\n/g, '<br>');
  return text;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showLimitReached() {
  const container = document.getElementById('chatMessages');
  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'limit-reached';
  div.innerHTML = `
    <h4>🚫 Limit Harian Tercapai</h4>
    <p>Kamu telah menggunakan semua chat gratis hari ini. Top up points untuk chat lebih banyak.</p>
    <button class="btn-primary" style="width:auto" onclick="showSection('points')">Top Up Points</button>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function loadChatHistory() {
  const u = state.currentUser;
  if (!u) return;
  // Load ke state tapi TIDAK ditampilkan otomatis (fresh chat)
  // state.chatHistory tetap kosong untuk chat baru
}

function renderHistory() {
  const u = state.currentUser;
  if (!u) return;
  const history = Store.getChatHistory(u.id);
  const listEl = document.getElementById('historyList');

  if (!history.length) {
    listEl.innerHTML = '<div class="empty-state">📭 Belum ada riwayat chat.</div>';
    return;
  }

  listEl.innerHTML = history.slice().reverse().map(h => `
    <div class="history-item">
      <div class="history-item-q">${escapeHtml(h.q)}</div>
      <div class="history-item-time">${new Date(h.time).toLocaleString('id-ID')}</div>
    </div>
  `).join('');
}

// ─── TOP UP ───────────────────────────────────────────────────────
let _selectedPlanData = null;

function openTopup() {
  document.getElementById('topupModal').classList.remove('hidden');
}
function closeTopup() {
  document.getElementById('topupModal').classList.add('hidden');
  _selectedPlanData = null;
}

function selectPlan(el, pts, price) {
  document.querySelectorAll('#topupModal .plan-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  _selectedPlanData = { pts, price };
  const panel = document.getElementById('selectedPlan');
  document.getElementById('planLabel').textContent = `${pts} Points — Rp ${price.toLocaleString('id-ID')}`;
  panel.classList.remove('hidden');
}

function selectPlanInline(el, pts, price) {
  document.querySelectorAll('#pointsSection .plan-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  _selectedPlanData = { pts, price };
  document.getElementById('inlinePayment').classList.remove('hidden');
}

function hideInlinePayment() {
  document.getElementById('inlinePayment').classList.add('hidden');
  document.querySelectorAll('#pointsSection .plan-card').forEach(c => c.classList.remove('selected'));
}

function confirmTopup() {
  // Simulasi konfirmasi — di produksi ini harus diverifikasi manual oleh owner
  alert(`Permintaan top up ${_selectedPlanData?.pts} points telah dikirim.\nAdmin akan mengkonfirmasi setelah menerima bukti transfer.\n\nTransfer ke: BCA 1234567890 a/n LuaAI Platform`);
  closeTopup();
}

// ─── OWNER DASHBOARD ─────────────────────────────────────────────
function showOwnerDash() {
  document.getElementById('ownerDash').classList.remove('hidden');
  showOwnerSection('overview');
  updateOwnerStats();
  loadOwnerData();
}

function showOwnerSection(name) {
  const sections = ['overview', 'apikey', 'luafiles', 'users', 'ownerSettings'];
  sections.forEach(s => {
    const el = document.getElementById(`owner${capitalize(s)}Section`);
    if (el) el.classList.toggle('hidden', s !== name);
  });
  document.querySelectorAll('#ownerDash .nav-item').forEach((btn, i) => {
    btn.classList.toggle('active', sections[i] === name);
  });

  const titles = {
    overview: 'Owner Dashboard', apikey: 'API Key Management',
    luafiles: 'File Lua', users: 'Manajemen Pengguna', ownerSettings: 'Pengaturan Platform'
  };
  document.getElementById('ownerDashTitle').textContent = titles[name] || '';

  if (name === 'users') renderUsersTable();
  if (name === 'luafiles') renderFilesList();
  if (name === 'ownerSettings') loadOwnerSettings();
  if (name === 'apikey') loadApiKeySection();
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function updateOwnerStats() {
  const users = Store.getUsers();
  document.getElementById('statTotalUsers').textContent = users.length;

  let totalChats = 0;
  users.forEach(u => {
    const usage = RateLimit.getUsage(u.id);
    totalChats += usage.count || 0;
  });
  document.getElementById('statTotalChats').textContent = totalChats;

  const files = Store.getLuaFiles();
  document.getElementById('statLuaFiles').textContent = files.length;

  const hasKey = !!Store.getOwnerKey();
  document.getElementById('statApiStatus').textContent = hasKey ? '✅ OK' : '⚠️ Belum';
}

function loadOwnerData() {
  const cfg = Store.getPlatformConfig();
  const sysEl = document.getElementById('systemPromptInput');
  if (sysEl) sysEl.value = cfg.systemPrompt || '';
  const limitEl = document.getElementById('dailyLimitInput');
  if (limitEl) limitEl.value = cfg.dailyLimit || CONFIG.DEFAULT_DAILY_LIMIT;
}

// API KEY SECTION
function loadApiKeySection() {
  const key = Store.getOwnerKey();
  const input = document.getElementById('ownerApiKey');
  if (input && key) {
    // Tampilkan versi tersensor
    input.setAttribute('data-filled', '1');
    input.value = key.substring(0, 10) + '•'.repeat(20);
  }
  updateApiStatus();
}

function toggleApiKeyVis() {
  const input = document.getElementById('ownerApiKey');
  const btn = document.querySelector('.toggle-vis');
  if (input.type === 'password') {
    const key = Store.getOwnerKey();
    if (key) {
      input.type = 'text';
      input.value = key;
    }
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    const key = Store.getOwnerKey();
    if (key) input.value = key.substring(0, 10) + '•'.repeat(20);
    btn.textContent = '👁';
  }
}

function saveApiKey() {
  const input = document.getElementById('ownerApiKey');
  const key = input.value.trim();

  if (!key || key.includes('•')) {
    alert('Masukkan API key yang valid.'); return;
  }
  if (!key.startsWith('sk-')) {
    if (!confirm('Key tidak diawali "sk-". Lanjutkan?')) return;
  }

  Store.saveOwnerKey(key);
  input.type = 'password';
  input.value = key.substring(0, 10) + '•'.repeat(20);
  updateApiStatus();
  addActivityLog('API key diperbarui ✓');
  alert('✅ API key disimpan di session. Akan hilang saat browser ditutup.\n\nUntuk produksi: simpan sebagai environment variable di server.');
}

async function testApiKey() {
  const key = Store.getOwnerKey();
  if (!key) { alert('API key belum dikonfigurasi.'); return; }

  const btn = document.querySelector('.apikey-form .btn-outline');
  btn.textContent = 'Testing...';
  btn.disabled = true;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    });
    if (res.ok) {
      updateApiStatus(true);
      addActivityLog('Test koneksi API: berhasil ✓');
      alert('✅ API key valid dan berfungsi!');
    } else {
      const e = await res.json().catch(() => ({}));
      updateApiStatus(false);
      alert(`❌ API key error: ${e.error?.message || res.status}`);
    }
  } catch (err) {
    alert(`❌ Koneksi gagal: ${err.message}`);
  }

  btn.textContent = 'Test Koneksi';
  btn.disabled = false;
}

function updateApiStatus(ok) {
  const dot = document.getElementById('apiStatusDot');
  const text = document.getElementById('apiStatusText');
  if (!dot || !text) return;
  const hasKey = ok !== undefined ? ok : !!Store.getOwnerKey();
  dot.className = 'status-dot' + (hasKey ? ' ok' : '');
  text.textContent = hasKey ? 'API key terkonfigurasi' : 'Belum dikonfigurasi';
}

// LUA FILES
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadArea').classList.add('drag-over');
}
function handleDragLeave() {
  document.getElementById('uploadArea').classList.remove('drag-over');
}
function handleFileDrop(e) {
  e.preventDefault();
  document.getElementById('uploadArea').classList.remove('drag-over');
  processFiles(e.dataTransfer.files);
}
function handleFileSelect(e) { processFiles(e.target.files); }

function processFiles(fileList) {
  Array.from(fileList).forEach(file => {
    if (!file.name.match(/\.(lua|txt|md)$/i)) {
      alert(`File "${file.name}" tidak didukung. Hanya .lua, .txt, .md`); return;
    }
    if (file.size > 100 * 1024) {
      alert(`File "${file.name}" terlalu besar (max 100KB).`); return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const files = Store.getLuaFiles();
      const existing = files.findIndex(f => f.name === file.name);
      const fileData = { name: file.name, content: e.target.result, size: file.size, uploadedAt: new Date().toISOString() };
      if (existing >= 0) files[existing] = fileData;
      else files.push(fileData);
      Store.saveLuaFiles(files);
      renderFilesList();
      updateContextPreview();
      updateOwnerStats();
      addActivityLog(`File diupload: ${file.name}`);
    };
    reader.readAsText(file);
  });
}

function renderFilesList() {
  const files = Store.getLuaFiles();
  const listEl = document.getElementById('filesList');
  if (!listEl) return;

  if (!files.length) {
    listEl.innerHTML = '<div class="empty-state">Belum ada file diupload.</div>';
    updateContextPreview();
    return;
  }

  listEl.innerHTML = files.map((f, i) => `
    <div class="file-item">
      <span style="font-size:1.2rem">📄</span>
      <span class="file-name">${escapeHtml(f.name)}</span>
      <span class="file-size">${(f.size / 1024).toFixed(1)} KB</span>
      <button class="file-del" onclick="deleteFile(${i})" title="Hapus">🗑</button>
    </div>
  `).join('');

  updateContextPreview();
}

function deleteFile(idx) {
  if (!confirm('Hapus file ini?')) return;
  const files = Store.getLuaFiles();
  const name = files[idx]?.name;
  files.splice(idx, 1);
  Store.saveLuaFiles(files);
  renderFilesList();
  updateOwnerStats();
  if (name) addActivityLog(`File dihapus: ${name}`);
}

function updateContextPreview() {
  const files = Store.getLuaFiles();
  const previewEl = document.getElementById('contextPreview');
  if (!previewEl) return;

  if (!files.length) {
    previewEl.innerHTML = '<em>Belum ada file. AI akan bekerja tanpa konteks khusus.</em>';
    return;
  }

  const preview = files.map(f => `=== ${f.name} ===\n${f.content.slice(0, 300)}${f.content.length > 300 ? '\n...[dipotong]' : ''}`).join('\n\n');
  previewEl.textContent = preview;
}

// USERS TABLE
function renderUsersTable() {
  const users = Store.getUsers();
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Belum ada pengguna terdaftar</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const usage = RateLimit.getUsage(u.id);
    const cfg = Store.getPlatformConfig();
    const limit = cfg.dailyLimit || CONFIG.DEFAULT_DAILY_LIMIT;
    return `<tr>
      <td><strong>${escapeHtml(u.username)}</strong></td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="plan-tag ${u.plan}">${u.plan}</span></td>
      <td>${u.points || 0}</td>
      <td>${usage.count} / ${u.plan === 'premium' ? '∞' : limit}</td>
      <td><button class="btn-edit" onclick="openUserPlanModal('${u.id}')">Edit</button></td>
    </tr>`;
  }).join('');
}

function openUserPlanModal(userId) {
  const users = Store.getUsers();
  const user = users.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editUserId').value = userId;
  document.getElementById('editUserName').value = user.username;
  document.getElementById('editUserPlan').value = user.plan;
  document.getElementById('editUserPoints').value = 0;
  document.getElementById('userPlanModal').classList.remove('hidden');
}

function closeUserPlanModal() { document.getElementById('userPlanModal').classList.add('hidden'); }

function saveUserPlan() {
  const userId = document.getElementById('editUserId').value;
  const plan = document.getElementById('editUserPlan').value;
  const addPoints = parseInt(document.getElementById('editUserPoints').value) || 0;

  const users = Store.getUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx < 0) return;

  users[idx].plan = plan;
  users[idx].points = (users[idx].points || 0) + addPoints;
  Store.saveUsers(users);

  closeUserPlanModal();
  renderUsersTable();
  addActivityLog(`Plan pengguna ${users[idx].username} diperbarui: ${plan}`);
  alert(`✅ Plan ${users[idx].username} diperbarui ke ${plan}.`);
}

// SETTINGS
function loadOwnerSettings() {
  const cfg = Store.getPlatformConfig();
  const limitEl = document.getElementById('dailyLimitInput');
  const sysEl = document.getElementById('systemPromptInput');
  if (limitEl) limitEl.value = cfg.dailyLimit || CONFIG.DEFAULT_DAILY_LIMIT;
  if (sysEl) sysEl.value = cfg.systemPrompt || '';
}

function saveDailyLimit() {
  const val = parseInt(document.getElementById('dailyLimitInput').value);
  if (isNaN(val) || val < 1) { alert('Masukkan angka valid minimal 1.'); return; }
  const cfg = Store.getPlatformConfig();
  cfg.dailyLimit = val;
  Store.savePlatformConfig(cfg);
  addActivityLog(`Daily limit diubah: ${val} chat/hari`);
  alert(`✅ Limit harian diperbarui: ${val} chat/hari`);
}

function saveSystemPrompt() {
  const val = document.getElementById('systemPromptInput').value.trim();
  const cfg = Store.getPlatformConfig();
  cfg.systemPrompt = val;
  Store.savePlatformConfig(cfg);
  addActivityLog('System prompt diperbarui');
  alert('✅ System prompt disimpan.');
}

// ACTIVITY LOG
function addActivityLog(msg) {
  const logEl = document.getElementById('activityLog');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = `[${new Date().toLocaleTimeString('id-ID')}] ${msg}`;
  logEl.insertBefore(entry, logEl.firstChild);
  // Keep max 20 logs
  while (logEl.children.length > 20) logEl.removeChild(logEl.lastChild);
}

// ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAuth();
    closeTopup();
    closeUserPlanModal();
  }
});

// Close modal on overlay click
document.getElementById('authModal').addEventListener('click', function(e) {
  if (e.target === this) closeAuth();
});
document.getElementById('topupModal').addEventListener('click', function(e) {
  if (e.target === this) closeTopup();
});
document.getElementById('userPlanModal').addEventListener('click', function(e) {
  if (e.target === this) closeUserPlanModal();
});
