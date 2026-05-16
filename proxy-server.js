/**
 * proxy-server.js — LuaAI Secure API Proxy
 * ═══════════════════════════════════════════════════════════════
 * 
 * TUJUAN: Menyembunyikan API key dari browser client.
 * API key HANYA ada di server ini sebagai environment variable.
 * 
 * Deploy ke: Vercel, Railway, Render, atau VPS manapun.
 * 
 * CARA INSTALL & JALANKAN:
 *   npm install express cors
 *   ANTHROPIC_API_KEY=sk-ant-xxxxx node proxy-server.js
 * 
 * ENVIRONMENT VARIABLES:
 *   ANTHROPIC_API_KEY  — API key Anthropic (WAJIB)
 *   PORT               — Port server (default: 3000)
 *   ALLOWED_ORIGIN     — Domain frontend kamu (default: *)
 * 
 * DEPLOY KE VERCEL:
 *   1. Rename ke api/chat.js
 *   2. Set env var ANTHROPIC_API_KEY di Vercel dashboard
 *   3. Ubah PROXY_URL di app.js ke '/api/chat'
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// ─── MIDDLEWARE ───────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

// ─── SECURITY: API key HANYA dari environment variable ────────────
function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY environment variable not set');
  return key;
}

// ─── RATE LIMIT sederhana (tambahkan Redis untuk produksi) ────────
const requestCounts = new Map();
function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const window = 60 * 1000; // 1 menit
  const max = 20;

  if (!requestCounts.has(ip)) requestCounts.set(ip, []);
  const requests = requestCounts.get(ip).filter(t => now - t < window);
  requests.push(now);
  requestCounts.set(ip, requests);

  if (requests.length > max) {
    return res.status(429).json({ error: 'Terlalu banyak request. Coba lagi nanti.' });
  }
  next();
}

// ─── PROXY ENDPOINT ───────────────────────────────────────────────
app.post('/api/chat', rateLimitMiddleware, async (req, res) => {
  try {
    const { messages, system } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Format request tidak valid' });
    }

    // Validasi messages
    if (messages.length > 50) {
      return res.status(400).json({ error: 'Terlalu banyak pesan' });
    }

    const apiKey = getApiKey(); // Ambil dari env, BUKAN dari request

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,           // ← Key tidak pernah ke client
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: system || 'Kamu adalah asisten kode Lua yang expert.',
        messages
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      // Jangan forward error detail yang bisa mengekspos info internal
      return res.status(response.status).json({
        error: 'AI service error',
        code: response.status
      });
    }

    const data = await response.json();

    // Hanya forward yang diperlukan, jangan seluruh response
    res.json({
      content: data.content,
      usage: data.usage
    });

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ─── 404 ──────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`LuaAI Proxy Server running on port ${PORT}`);
  console.log(`API Key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
});

module.exports = app;

/* ─── UNTUK VERCEL (api/chat.js) ────────────────────────────────
// Ganti module.exports = app dengan:

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // ... (salin logic dari app.post('/api/chat') di atas)
};
*/
