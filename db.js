const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pc_envanter',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4_turkish_ci',
  timezone: '+03:00'
});

async function columnInfo(table, column) {
  const [rows] = await pool.query(
    `SELECT IS_NULLABLE FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, [table, column]);
  return rows[0] || null;
}

async function indexExists(table, index) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`, [table, index]);
  return rows.length > 0;
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      role ENUM('admin', 'tech') NOT NULL DEFAULT 'tech',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS personnel (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      old_pc_name VARCHAR(100) NULL,
      department VARCHAR(100) NULL,
      desktop TINYINT(1) NOT NULL DEFAULT 0,
      new_pc_serial VARCHAR(64) NULL,
      UNIQUE KEY uq_person (full_name, old_pc_name)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      personnel_id INT NULL,
      old_pc_name VARCHAR(100) NULL,
      old_pc_serial VARCHAR(64) NULL,
      new_pc_serial VARCHAR(64) NULL,
      desktop TINYINT(1) NOT NULL DEFAULT 0,
      todo TEXT NULL,
      notes VARCHAR(500) NULL,
      created_by INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_created_at (created_at),
      KEY idx_new_serial (new_pc_serial),
      CONSTRAINT fk_entries_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id),
      CONSTRAINT fk_entries_user FOREIGN KEY (created_by) REFERENCES app_users(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci`);

  // Kayit formu alan kurallari: zorunluluk ve bicim (regex) admin panelinden yonetilir
  await pool.query(`
    CREATE TABLE IF NOT EXISTS field_rules (
      field_name VARCHAR(32) PRIMARY KEY,
      label VARCHAR(64) NOT NULL,
      required TINYINT(1) NOT NULL DEFAULT 0,
      pattern VARCHAR(200) NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci`);

  // --- Eski semadan gecis (idempotent) ---
  // personnel.old_pc_serial kaldirildi: eski seri no artik degisim aninda formda girilir,
  // personelle onceden yuklenen bilgi old_pc_name oldu.
  if (await columnInfo('personnel', 'old_pc_serial')) {
    if (await indexExists('personnel', 'uq_person')) {
      await pool.query('ALTER TABLE personnel DROP INDEX uq_person');
    }
    await pool.query('ALTER TABLE personnel DROP COLUMN old_pc_serial');
  }
  if (!(await columnInfo('personnel', 'old_pc_name'))) {
    await pool.query('ALTER TABLE personnel ADD COLUMN old_pc_name VARCHAR(100) NULL AFTER full_name');
  }
  if (!(await indexExists('personnel', 'uq_person'))) {
    await pool.query('ALTER TABLE personnel ADD UNIQUE KEY uq_person (full_name, old_pc_name)');
  }
  if (!(await columnInfo('entries', 'old_pc_name'))) {
    await pool.query('ALTER TABLE entries ADD COLUMN old_pc_name VARCHAR(100) NULL AFTER personnel_id');
  }
  // Alanlar varsayilan olarak zorunlu olmadigi icin NULL'a izin ver
  const pid = await columnInfo('entries', 'personnel_id');
  if (pid && pid.IS_NULLABLE === 'NO') {
    await pool.query('ALTER TABLE entries MODIFY personnel_id INT NULL');
  }
  const nps = await columnInfo('entries', 'new_pc_serial');
  if (nps && nps.IS_NULLABLE === 'NO') {
    await pool.query('ALTER TABLE entries MODIFY new_pc_serial VARCHAR(64) NULL');
  }
  // desktop (masaustu mu?) ve todo alanlari sonradan eklendi
  if (!(await columnInfo('entries', 'desktop'))) {
    await pool.query('ALTER TABLE entries ADD COLUMN desktop TINYINT(1) NOT NULL DEFAULT 0 AFTER new_pc_serial');
  }
  if (!(await columnInfo('entries', 'todo'))) {
    await pool.query('ALTER TABLE entries ADD COLUMN todo TEXT NULL AFTER desktop');
  }
  // personnel: CSV ile onceden yuklenen desktop ve yeni seri no bilgisi
  if (!(await columnInfo('personnel', 'desktop'))) {
    await pool.query('ALTER TABLE personnel ADD COLUMN desktop TINYINT(1) NOT NULL DEFAULT 0 AFTER department');
  }
  if (!(await columnInfo('personnel', 'new_pc_serial'))) {
    await pool.query('ALTER TABLE personnel ADD COLUMN new_pc_serial VARCHAR(64) NULL AFTER desktop');
  }

  // Kural satirlarini tohumla (varsayilan: hicbir alan zorunlu degil, desen yok)
  await pool.query(`
    INSERT IGNORE INTO field_rules (field_name, label, required, pattern) VALUES
      ('personnel_id',  'Kullanıcı',        0, NULL),
      ('old_pc_serial', 'Eski PC Seri No',  0, NULL),
      ('new_pc_serial', 'Yeni PC Seri No',  0, NULL),
      ('todo',          '#TODO',            0, NULL),
      ('notes',         'Not',              0, NULL)`);

  // Ilk calistirmada varsayilan admin olustur
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM app_users');
  if (c === 0) {
    const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';
    await pool.query('INSERT INTO app_users (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', bcrypt.hashSync(defaultPass, 10), 'admin']);
    console.log(`Varsayilan admin olusturuldu (kullanici: admin, sifre: ${process.env.ADMIN_PASSWORD ? '[ADMIN_PASSWORD env]' : 'admin123 — ILK GIRISTE DEGISTIRIN'})`);
  }
}

module.exports = { pool, init };
