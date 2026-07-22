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
app.use('/vendor/tesseract.js', express.static(path.join(__dirname, 'node_modules', 'tesseract.js')));
app.use('/vendor/tesseract-core', express.static(path.join(__dirname, 'node_modules', 'tesseract.js-core')));
app.use('/vendor/tessdata', express.static(path.join(__dirname, 'node_modules', '@tesseract.js-data', 'eng')));
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

// Cihaz tipi: 'D' Desktop, 'N' Notebook, 'V' VDI, 'W' Workgroup. Form/CSV girdisini normalize eder.
// Geriye donuk uyum: eski 1/true/evet/x -> Desktop, 0/false/hayir/bos -> Notebook.
const DEVICE_LABELS = { D: 'Desktop', N: 'Notebook', V: 'VDI', W: 'Workgroup' };
function normalizeDevice(raw) {
  const s = String(raw == null ? '' : raw).trim().toUpperCase();
  if (s === 'D' || s === 'DESKTOP' || /^(1|TRUE|EVET|X)$/.test(s)) return 'D';
  if (s === 'V' || s === 'VDI') return 'V';
  if (s === 'W' || s === 'WORKGROUP') return 'W';
  return 'N'; // N/NOTEBOOK ve tanimsiz/0/false/hayir varsayilani
}

// Sira numarasi: pozitif tam sayi degilse null (otomatik atanacak)
function parseSeq(raw) {
  const n = parseInt(String(raw == null ? '' : raw).trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
// Tablodaki en buyuk seq_no + 1 (bos tabloda 1)
async function nextSeqNo(conn = pool) {
  const [[{ mx }]] = await conn.query('SELECT COALESCE(MAX(seq_no), 0) AS mx FROM personnel');
  return mx + 1;
}

// --- Ana sayfa: kayıt formu ---
app.get('/', requireLogin, wrap(async (req, res) => {
  const [personnel] = await pool.query('SELECT * FROM personnel ORDER BY seq_no, full_name');
  const rules = await getRules();
  res.render('index', { personnel, rules });
}));

app.post('/kayit', requireLogin, wrap(async (req, res) => {
  const rules = await getRules();
  const oldSerial = (req.body.old_pc_serial || '').trim().toUpperCase() || null;
  const newSerial = (req.body.new_pc_serial || '').trim().toUpperCase() || null;
  const oldPcName = (req.body.old_pc_name || '').trim() || null;
  const department = (req.body.department || '').trim() || null;
  const desktop = normalizeDevice(req.body.desktop);
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
    // Aynı kişinin PC'sini yeniden kaydetmek (cihaz tipi/todo/not vb. güncellemek) serbest;
    // yalnızca seri no BAŞKA bir kişiye (veya kullanıcısız kayda) aitse mükerrer say.
    let dupSql = 'SELECT id FROM entries WHERE new_pc_serial = ?';
    const dupParams = [newSerial];
    if (p) { dupSql += ' AND (personnel_id IS NULL OR personnel_id <> ?)'; dupParams.push(p.id); }
    const [[dup]] = await pool.query(dupSql + ' LIMIT 1', dupParams);
    if (dup) errors.push(`Bu yeni seri no ile başka bir kayıt var (#${dup.id}).`);
  }
  if (errors.length) {
    req.session.flash = { type: 'error', msg: errors.join(' ') };
    return res.redirect('/');
  }

  await pool.query(
    `INSERT INTO entries (personnel_id, old_pc_name, new_pc_name, department, old_pc_serial, new_pc_serial, desktop, todo, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p ? p.id : null, oldPcName, p ? p.new_pc_name : null, department, oldSerial, newSerial, desktop, todo, notes, req.session.user.id]);

  // entries geriye dönük kaydın (anlık) günlüğüdür; personnel ise güncel durumu tutar.
  // Formda değiştirilebilen alanları seçilen personele yaz ki aynı kişi tekrar arandığında
  // en son bilgilerle gelsin. Cihaz tipi/seri/eski PC adı/departman'da boş bırakılan alan
  // mevcut değeri silmez (COALESCE). #TODO ve Not ise doğrudan yazılır (forma ön-dolar ve
  // düzenlenebilir olduğu için temizlenmek istenirse boş da yazılabilsin).
  if (p) {
    try {
      await pool.query(
        `UPDATE personnel SET desktop = ?,
           old_pc_name = COALESCE(?, old_pc_name),
           department = COALESCE(?, department),
           old_pc_serial = COALESCE(?, old_pc_serial),
           new_pc_serial = COALESCE(?, new_pc_serial),
           todo = ?,
           notes = ?
         WHERE id = ?`,
        [desktop, oldPcName, department, oldSerial, newSerial, todo, notes, p.id]);
    } catch (e) {
      // old_pc_name degisimi UNIQUE(full_name, old_pc_name) ile cakisabilir;
      // kayit (entry) yine de olustu, personel senkronu atlanir.
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }

  const who = p ? p.full_name : 'kullanıcısız kayıt';
  req.session.flash = { type: 'success', msg: `Kayıt oluşturuldu: ${who}${newSerial ? ' → ' + newSerial : ''}` };
  res.redirect('/');
}));

// --- Kayıt listesi ---
// department entries'in kendi anlik kolonundan gelir (p.department degil) ki
// personel sonradan guncellense de gecmis kayit o anki degeri gostersin.
const ENTRY_SELECT = `
  SELECT e.*, p.seq_no, p.full_name, u.username AS created_by_name
  FROM entries e
  LEFT JOIN personnel p ON p.id = e.personnel_id
  JOIN app_users u ON u.id = e.created_by`;

app.get('/kayitlar', requireLogin, wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    [rows] = await pool.query(`${ENTRY_SELECT}
      WHERE p.full_name LIKE ? OR e.new_pc_serial LIKE ? OR e.old_pc_serial LIKE ? OR e.old_pc_name LIKE ? OR e.new_pc_name LIKE ?
      ORDER BY e.created_at DESC`, [like, like, like, like, like]);
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
    SELECT e.id, p.full_name, e.department, e.old_pc_name, e.new_pc_name, e.old_pc_serial, e.new_pc_serial,
           e.desktop, e.todo, e.notes, u.username AS created_by,
           DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i') AS created_at
    FROM entries e
    LEFT JOIN personnel p ON p.id = e.personnel_id
    JOIN app_users u ON u.id = e.created_by
    ORDER BY e.created_at DESC`);
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const header = 'ID;Kullanici;Departman;Eski PC Adi;Yeni PC Adi;Eski Seri No;Yeni Seri No;Cihaz Tipi;#TODO;Not;Kaydeden;Tarih';
  const lines = rows.map(r => [r.id, r.full_name, r.department, r.old_pc_name, r.new_pc_name, r.old_pc_serial,
    r.new_pc_serial, DEVICE_LABELS[r.desktop] || '', r.todo, r.notes, r.created_by, r.created_at].map(esc).join(';'));
  const csv = '﻿' + [header, ...lines].join('\r\n'); // BOM: Excel'de Türkçe karakterler için
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="envanter-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// --- Admin: personel yönetimi + CSV import ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Personel listesi CSV export — import ile ayni sutun duzeni (tekrar yuklenebilir)
app.get('/admin/personel/export', requireAdmin, wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT seq_no, full_name, old_pc_name, new_pc_name, department, desktop, old_pc_serial, new_pc_serial FROM personnel ORDER BY seq_no, full_name');
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const header = 'Numara;Ad Soyad;Eski PC Adi;Yeni PC Adi;Departman;Desktop;Eski PC Seri No;Yeni PC Seri No';
  const lines = rows.map(r => [r.seq_no, r.full_name, r.old_pc_name, r.new_pc_name, r.department,
    r.desktop, r.old_pc_serial, r.new_pc_serial].map(esc).join(';'));
  const csv = '﻿' + [header, ...lines].join('\r\n'); // BOM: Excel'de Türkçe karakterler için
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="personel-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

app.get('/admin', requireAdmin, wrap(async (req, res) => {
  const [personnel] = await pool.query('SELECT * FROM personnel ORDER BY seq_no, full_name');
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
  const { full_name, old_pc_name, new_pc_name, department, old_pc_serial, new_pc_serial } = req.body;
  if (!(full_name || '').trim()) {
    req.session.flash = { type: 'error', msg: 'Ad soyad zorunludur.' };
    return res.redirect('/admin');
  }
  try {
    const seq = parseSeq(req.body.seq_no) ?? await nextSeqNo();
    await pool.query(
      'INSERT INTO personnel (seq_no, full_name, old_pc_name, new_pc_name, department, desktop, old_pc_serial, new_pc_serial) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [seq, full_name.trim(), (old_pc_name || '').trim() || null, (new_pc_name || '').trim() || null, (department || '').trim() || null,
       normalizeDevice(req.body.desktop), (old_pc_serial || '').trim().toUpperCase() || null, (new_pc_serial || '').trim().toUpperCase() || null]);
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

// CSV formati: numara;full_name;old_pc_name;new_pc_name;department;desktop;old_pc_serial;new_pc_serial
// (; veya , ayiracli, baslik satiri opsiyonel). Bos alanlar importu durdurmaz.
// numara: bos ise tablodaki son numaradan otomatik artar (bos tabloda 1'den baslar)
// desktop: D/N/V/W (geriye donuk 1/0, true/false, evet/hayır, x)
// Numara sutunu olmayan eski formatlar da desteklenir (bkz. hasSeqCol tespiti).
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
  // İlk sütun "Numara" mı yoksa doğrudan ad mı? Başlık varsa ondan, yoksa ilk
  // veri hücresinin sayısal/boş olmasından anlaşılır. Eski (numarasız) CSV'ler de çalışır.
  let hasSeqCol = false;
  if (records.length) {
    const c0 = (records[0][0] || '').trim();
    const headerLike = /ad soyad|full.?name|^ad$|numara|^no$|sıra|sira/i.test(c0) || /ad|name/i.test(records[0][1] || '');
    if (headerLike) {
      hasSeqCol = /numara|^no$|sıra|sira/i.test(c0);
      records.shift();
    } else {
      // Başlıksız: ilk hücre boş ya da tam sayı ise Numara sütunu var say
      hasSeqCol = c0 === '' || /^\d+$/.test(c0);
    }
  }
  const off = hasSeqCol ? 1 : 0; // ad soyad ve sonraki alanlar için sütun kayması

  let added = 0, skipped = 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let nextSeq = await nextSeqNo(conn);
    for (const r of records) {
      const name = (r[off] || '').trim();
      if (!name) { skipped++; continue; }
      const desktop = normalizeDevice(r[off + 4]);
      const seq = (hasSeqCol ? parseSeq(r[0]) : null) ?? nextSeq;
      const [result] = await conn.query(
        'INSERT IGNORE INTO personnel (seq_no, full_name, old_pc_name, new_pc_name, department, desktop, old_pc_serial, new_pc_serial) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [seq, name, (r[off + 1] || '').trim() || null, (r[off + 2] || '').trim() || null, (r[off + 3] || '').trim() || null,
         desktop, (r[off + 5] || '').trim().toUpperCase() || null, (r[off + 6] || '').trim().toUpperCase() || null]);
      if (result.affectedRows) { added++; nextSeq = Math.max(nextSeq, seq) + 1; } else { skipped++; }
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
