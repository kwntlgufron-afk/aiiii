# LuaAI Platform — Panduan Deploy

## 📁 Struktur File
```
luaai/
├── index.html        ← Halaman utama (semua UI)
├── styles.css        ← Styling dark blue / red theme
├── app.js            ← Logic frontend (TANPA API key)
├── proxy-server.js   ← Backend proxy (menyimpan API key)
└── README.md         ← File ini
```

---

## 🚀 Deploy ke GitHub Pages (Demo Mode)

1. Buat repo GitHub baru (misal: `luaai`)
2. Upload semua file ke repo
3. Buka Settings → Pages → Source: `main` / root
4. Website live di `https://username.github.io/luaai/`

**Catatan GitHub Pages:**
- API key dimasukkan oleh owner lewat panel (tersimpan di sessionStorage)
- Lebih aman jika deploy backend proxy juga (lihat bawah)

---

## 🔐 Deploy Backend Proxy (DIREKOMENDASIKAN)

Agar API key 100% tidak terekspos ke browser:

### Opsi A: Vercel (Gratis)
```bash
npm install -g vercel
# Buat folder api/
# Rename proxy-server.js ke api/chat.js (ikuti format Vercel functions)
vercel --prod
# Di Vercel dashboard: Settings → Environment Variables
# Tambah: ANTHROPIC_API_KEY = sk-ant-...
```

### Opsi B: Railway
```bash
npm init
npm install express cors
# Set env var ANTHROPIC_API_KEY di Railway dashboard
railway up
```

### Setelah deploy backend:
Di `app.js`, ubah baris:
```js
const PROXY_URL = './api/chat';
// → ganti dengan URL backend kamu:
const PROXY_URL = 'https://luaai-api.vercel.app/api/chat';
```

---

## 👤 Login Owner

- **Username:** `Marvel`  
- **Password:** `Marvel@2025`

Setelah login, buka panel **API Key** untuk memasukkan Anthropic API key.

---

## 🔒 Arsitektur Keamanan

```
Browser (User)
    │
    │ Tidak ada API key di sini!
    ▼
proxy-server.js (Backend)
    │ ← API key dari environment variable
    ▼
Anthropic API
```

### Yang TIDAK dilakukan:
- ❌ API key tidak disimpan di localStorage
- ❌ API key tidak dikirim ke client
- ❌ API key tidak ada di file JS yang bisa dilihat user

### Yang DILAKUKAN:
- ✅ API key hanya di server environment variable
- ✅ Rate limiting per IP di proxy
- ✅ Session-only storage untuk owner key (demo mode)
- ✅ Password di-hash sebelum disimpan
- ✅ Input validation di semua form

---

## ⚙️ Konfigurasi Owner

| Pengaturan | Lokasi | Default |
|------------|--------|---------|
| Daily chat limit | Panel Settings | 5 |
| System prompt AI | Panel Settings | Built-in |
| File Lua referensi | Panel File Lua | — |
| Plan pengguna | Panel Pengguna | Free |

---

## 💳 Top Up Points

| Paket | Points | Harga |
|-------|--------|-------|
| Starter | 50 | Rp 15.000 |
| Popular | 100 | Rp 25.000 |
| Pro | 200 | Rp 45.000 |

---

## 📞 Support

Untuk pertanyaan, hubungi: admin@luaai.app
