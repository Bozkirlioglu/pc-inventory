require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');

const { pool, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/html5-qrcode', express.static(path.join(__dirname, 'node_modules', 'html5-qrcode')));
app.set('trust proxy', 1); // reverse proxy (nginx/IIS) arkasinda dogru IP ve secure cookie icin

const sessionStore = new MySQLStore({}, pool.pool); // mysql2/promise pool'un callback sarmalayicisi

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'degistir-bu-anahtari',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000 // 8 saat
  }
}));

// --- Middleware ---
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Yetkisiz');
  next();
}
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// Async route hatalarini yakala
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Basit brute-force koruması (login) ---
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const rec = loginAttempts.get(req.ip) || { count: 0, until: 0 };
  if (Date.now() < rec.until) {
    return res.status(429).render('login', { error: 'Çok fazla deneme. 5 dakika sonra tekrar deneyin.' });
  }
  next();
}
function recordLoginFail(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  rec.count++;
  if (rec.count >= 5) { rec.until = Date.now() + 5 * 60 * 1000; rec.count = 0; }
  loginAttempts.set(ip, rec);
}

// --- Auth ---
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', loginRateLimit, wrap(async (req, res) => {
  const { username, password } = req.body;
  const [[u]] = await pool.query('SELECT * FROM app_users WHERE username = ?', [username || '']);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    recordLoginFail(req.ip);
    return res.render('login', { error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  loginAttempts.delete(req.ip);
  req.session.user = { id: u.id, username: u.username, role: u.role };
  res.redirect('/');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/sifre-degistir', requireLogin, (req, res) => {
  res.render('change-password', { error: null });
});

app.post('/sifre-degistir', requireLogin, wrap(async (req, res) => {
  const { current, newpass, newpass2 } = req.body;
  const [[u]] = await pool.query('SELECT * FROM app_users WHERE id = ?', [req.session.user.id]);
  if (!bcrypt.compareSync(current || '', u.password_hash)) {
    return res.render('change-password', { error: 'Mevcut şifre hatalı.' });
  }
  if (!newpass || newpass.length < 8) {
    return res.render('change-password', { error: 'Yeni şifre en az 8 karakter olmalı.' });
  }
  if (newpass !== newpass2) {
    return res.render('change-password', { error: 'Yeni şifreler eşleşmiyor.' });
  }
  await pool.query('UPDATE app_users SET password_hash = ? WHERE id = ?',
    [bcrypt.hashSync(newpass, 10), u.id]);
  req.session.flash = { type: 'success', msg: 'Şifre güncellendi.' };
  res.redirect('/');
}));

// --- Alan kuralları yardımcısı ---
async function getRules() {
  const [rows] = await pool.query('SELECT * FROM field_rules');
  return Object.fromEntries(rows.map(r => [r.field_name, r]));
}

// --- Ana sayfa: kayıt formu ---
app.get('/', requireLogin, wrap(async (req, res) => {
  const [personnel] = await pool.query('SELECT * FROM personnel ORDER BY full_name');
  const rules = await getRules();
  res.render('index', { personnel, rules });
}));

app.post('/kayit', requireLogin, wrap(async (req, res) => {
  const rules = await getRules();
  const oldSerial = (req.body.old_pc_serial || '').trim().toUpperCase() || null;
  const newSerial = (req.body.new_pc_serial || '').trim().toUpperCase() || null;
  const desktop = req.body.desktop ? 1 : 0;
  const todo = (req.body.todo || '').trim() || null;
  const notes = (req.body.notes || '').trim() || null;

  let p = null;
  if ((req.body.personnel_id || '').trim()) {
    [[p]] = await pool.query('SELECT * FROM personnel WHERE id = ?', [req.body.personnel_id]);
    if (!p) {
      req.session.flash = { type: 'error', msg: 'Geçersiz kullanıcı seçimi.' };
      return res.redirect('/');
    }
  }

  // Kural tablosuna göre doğrulama: zorunluluk + opsiyonel biçim deseni (regex)
  const values = {
    personnel_id: p ? String(p.id) : '',
    old_pc_serial: oldSerial || '',
    new_pc_serial: newSerial || '',
    todo: todo || '',
    notes: notes || ''
  };
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    const v = values[field] ?? '';
    if (rule.required && !v) {
      errors.push(`${rule.label} zorunludur.`);
    } else if (rule.pattern && v) {
      try {
        if (!new RegExp(rule.pattern).test(v)) errors.push(`${rule.label} beklenen biçime uymuyor.`);
      } catch (e) { /* bozuk desen dogrulamayi engellemesin */ }
    }
  }
  if (newSerial) {
    const [[dup]] = await pool.query('SELECT id FROM entries WHERE new_pc_serial = ?', [newSerial]);
    if (dup) errors.push(`Bu yeni seri no ile zaten kayıt var (#${dup.id}).`);
  }
  if (errors.length) {
    req.session.flash = { type: 'error', msg: errors.join(' ') };
    return res.redirect('/');
  }

  await pool.query(
    `INSERT INTO entries (personnel_id, old_pc_name, old_pc_serial, new_pc_serial, desktop, todo, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p ? p.id : null, p ? p.old_pc_name : null, oldSerial, newSerial, desktop, todo, notes, req.session.user.id]);
  const who = p ? p.full_name : 'kullanıcısız kayıt';
  req.session.flash = { type: 'success', msg: `Kayıt oluşturuldu: ${who}${newSerial ? ' → ' + newSerial : ''}` };
  res.redirect('/');
}));

// --- Kayıt listesi ---
const ENTRY_SELECT = `
  SELECT e.*, p.full_name, p.department, u.username AS created_by_name
  FROM entries e
  LEFT JOIN personnel p ON p.id = e.personnel_id
  JOIN app_users u ON u.id = e.created_by`;

app.get('/kayitlar', requireLogin, wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    [rows] = await pool.query(`${ENTRY_SELECT}
      WHERE p.full_name LIKE ? OR e.new_pc_serial LIKE ? OR e.old_pc_serial LIKE ? OR e.old_pc_name LIKE ?
      ORDER BY e.created_at DESC`, [like, like, like, like]);
  } else {
    [rows] = await pool.query(`${ENTRY_SELECT} ORDER BY e.created_at DESC`);
  }
  res.render('entries', { rows, q });
}));

app.post('/kayitlar/:id/sil', requireAdmin, wrap(async (req, res) => {
  await pool.query('DELETE FROM entries WHERE id = ?', [req.params.id]);
  req.session.flash = { type: 'success', msg: 'Kayıt silindi.' };
  res.redirect('/kayitlar');
}));

// --- CSV export ---
app.get('/kayitlar/export', requireLogin, wrap(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT e.id, p.full_name, p.department, e.old_pc_name, e.old_pc_serial, e.new_pc_serial,
           e.desktop, e.todo, e.notes, u.username AS created_by,
           DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i') AS created_at
    FROM entries e
    LEFT JOIN personnel p ON p.id = e.personnel_id
    JOIN app_users u ON u.id = e.created_by
    ORDER BY e.created_at DESC`);
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const header = 'ID;Kullanici;Departman;Eski PC Adi;Eski Seri No;Yeni Seri No;Desktop;#TODO;Not;Kaydeden;Tarih';
  const lines = rows.map(r => [r.id, r.full_name, r.department, r.old_pc_name, r.old_pc_serial,
    r.new_pc_serial, r.desktop ? 1 : 0, r.todo, r.notes, r.created_by, r.created_at].map(esc).join(';'));
  const csv = '﻿' + [header, ...lines].join('\r\n'); // BOM: Excel'de Türkçe karakterler için
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="envanter-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// --- Admin: personel yönetimi + CSV import ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

app.get('/admin', requireAdmin, wrap(async (req, res) => {
  const [personnel] = await pool.query('SELECT * FROM personnel ORDER BY full_name');
  const [techs] = await pool.query('SELECT id, username, role, created_at FROM app_users ORDER BY username');
  const [ruleRows] = await pool.query('SELECT * FROM field_rules ORDER BY field_name');
  res.render('admin', { personnel, techs, ruleRows });
}));

// Alan kurallarını güncelle (zorunluluk + biçim deseni)
app.post('/admin/kurallar', requireAdmin, wrap(async (req, res) => {
  const [ruleRows] = await pool.query('SELECT field_name, label FROM field_rules');
  for (const r of ruleRows) {
    const pattern = (req.body[`pattern_${r.field_name}`] || '').trim() || null;
    if (pattern) {
      try { new RegExp(pattern); } catch (e) {
        req.session.flash = { type: 'error', msg: `"${r.label}" için geçersiz desen: ${pattern}` };
        return res.redirect('/admin');
      }
    }
    const required = req.body[`required_${r.field_name}`] ? 1 : 0;
    await pool.query('UPDATE field_rules SET required = ?, pattern = ? WHERE field_name = ?',
      [required, pattern, r.field_name]);
  }
  req.session.flash = { type: 'success', msg: 'Alan kuralları güncellendi.' };
  res.redirect('/admin');
}));

app.post('/admin/personel', requireAdmin, wrap(async (req, res) => {
  const { full_name, old_pc_name, department, new_pc_serial } = req.body;
  if (!(full_name || '').trim()) {
    req.session.flash = { type: 'error', msg: 'Ad soyad zorunludur.' };
    return res.redirect('/admin');
  }
  try {
    await pool.query('INSERT INTO personnel (full_name, old_pc_name, department, desktop, new_pc_serial) VALUES (?, ?, ?, ?, ?)',
      [full_name.trim(), (old_pc_name || '').trim() || null, (department || '').trim() || null,
       req.body.desktop ? 1 : 0, (new_pc_serial || '').trim().toUpperCase() || null]);
    req.session.flash = { type: 'success', msg: 'Personel eklendi.' };
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    req.session.flash = { type: 'error', msg: 'Bu kayıt zaten mevcut.' };
  }
  res.redirect('/admin');
}));

app.post('/admin/personel/:id/sil', requireAdmin, wrap(async (req, res) => {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM entries WHERE personnel_id = ?', [req.params.id]);
  if (c > 0) {
    req.session.flash = { type: 'error', msg: 'Bu personele ait kurulum kaydı var, silinemez.' };
  } else {
    await pool.query('DELETE FROM personnel WHERE id = ?', [req.params.id]);
    req.session.flash = { type: 'success', msg: 'Personel silindi.' };
  }
  res.redirect('/admin');
}));

// CSV formatı: full_name;old_pc_name;department;desktop;new_pc_serial  (; veya , ayraçlı, başlık satırı opsiyonel)
// desktop: 1/0, true/false, evet/hayır, x kabul edilir
app.post('/admin/import', requireAdmin, upload.single('csv'), wrap(async (req, res) => {
  if (!req.file) {
    req.session.flash = { type: 'error', msg: 'Dosya seçilmedi.' };
    return res.redirect('/admin');
  }
  const text = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  let records;
  try {
    records = parse(text, { delimiter, trim: true, skip_empty_lines: true, relax_column_count: true });
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'CSV okunamadı: ' + e.message };
    return res.redirect('/admin');
  }
  // Başlık satırını atla (ilk hücre "ad" veya "name" içeriyorsa)
  if (records.length && /ad|name/i.test(records[0][0])) records.shift();

  let added = 0, skipped = 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of records) {
      const name = (r[0] || '').trim();
      if (!name) { skipped++; continue; }
      const desktop = /^(1|true|evet|x)$/i.test((r[3] || '').trim()) ? 1 : 0;
      const [result] = await conn.query(
        'INSERT IGNORE INTO personnel (full_name, old_pc_name, department, desktop, new_pc_serial) VALUES (?, ?, ?, ?, ?)',
        [name, (r[1] || '').trim() || null, (r[2] || '').trim() || null,
         desktop, (r[4] || '').trim().toUpperCase() || null]);
      result.affectedRows ? added++ : skipped++;
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  req.session.flash = { type: 'success', msg: `Import tamamlandı: ${added} eklendi, ${skipped} atlandı (boş/mükerrer).` };
  res.redirect('/admin');
}));

// Admin: teknisyen hesabı ekle
app.post('/admin/kullanici', requireAdmin, wrap(async (req, res) => {
  const { username, password, role } = req.body;
  if (!(username || '').trim() || !password || password.length < 8) {
    req.session.flash = { type: 'error', msg: 'Kullanıcı adı zorunlu, şifre en az 8 karakter olmalı.' };
    return res.redirect('/admin');
  }
  try {
    await pool.query('INSERT INTO app_users (username, password_hash, role) VALUES (?, ?, ?)',
      [username.trim(), bcrypt.hashSync(password, 10), role === 'admin' ? 'admin' : 'tech']);
    req.session.flash = { type: 'success', msg: 'Kullanıcı eklendi.' };
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    req.session.flash = { type: 'error', msg: 'Bu kullanıcı adı zaten mevcut.' };
  }
  res.redirect('/admin');
}));

// Genel hata yakalayici
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Sunucu hatası. Loglara bakın.');
});

init()
  .then(() => {
    app.listen(PORT, () => console.log(`PC Envanter uygulaması http://localhost:${PORT} adresinde çalışıyor`));
  })
  .catch(err => {
    console.error('Veritabanına bağlanılamadı:', err.message);
    console.error('MySQL çalışıyor mu ve .env ayarları doğru mu kontrol edin.');
    process.exit(1);
  });
