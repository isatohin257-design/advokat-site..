const express = require('express');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'bookings.sqlite'));

db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  service TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, time)
)`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const allowedServices = new Set(['Гражданское дело', 'Семейное дело', 'Юридическая консультация']);
const allowedTimes = new Set(['10:00', '11:00', '12:00', '14:00', '15:00', '16:00']);
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date && date >= new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}
function adminOnly(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Администратор не настроен. Установите переменную ADMIN_PASSWORD.' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Неверный пароль администратора.' });
  next();
}

app.get('/api/slots', (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Укажите дату в формате ГГГГ-ММ-ДД.' });
  const rows = db.prepare("SELECT time FROM bookings WHERE date = ? AND status != 'cancelled'").all(date);
  res.json({ date, times: [...allowedTimes].filter(t => !rows.some(r => r.time === t)) });
});

app.post('/api/bookings', (req, res) => {
  const { name, phone, service, date, time, details = '', consent } = req.body || {};
  if (!consent) return res.status(400).json({ error: 'Необходимо согласие на обработку персональных данных.' });
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) return res.status(400).json({ error: 'Введите имя (от 2 до 100 символов).' });
  if (typeof phone !== 'string' || !/^[+()\d\s-]{7,25}$/.test(phone.trim())) return res.status(400).json({ error: 'Проверьте номер телефона.' });
  if (!allowedServices.has(service)) return res.status(400).json({ error: 'Выберите услугу из списка.' });
  if (!validDate(date)) return res.status(400).json({ error: 'Выберите сегодняшнюю или будущую дату.' });
  if (!allowedTimes.has(time)) return res.status(400).json({ error: 'Выберите время из списка.' });
  if (typeof details !== 'string' || details.length > 1000) return res.status(400).json({ error: 'Описание должно быть не длиннее 1000 символов.' });
  try {
    const result = db.prepare('INSERT INTO bookings (name, phone, service, date, time, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), phone.trim(), service, date, time, details.trim());
    res.status(201).json({ ok: true, bookingId: result.lastInsertRowid, message: 'Заявка принята. Адвокат свяжется с вами для подтверждения.' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Это время уже занято. Выберите другое.' });
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить заявку. Попробуйте позже.' });
  }
});

app.get('/api/admin/bookings', adminOnly, (req, res) => {
  const rows = db.prepare("SELECT id, name, phone, service, date, time, details, status, created_at FROM bookings ORDER BY date DESC, time ASC LIMIT 500").all();
  res.json({ bookings: rows });
});

app.patch('/api/admin/bookings/:id', adminOnly, (req, res) => {
  const status = req.body && req.body.status;
  if (!['new', 'confirmed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Недопустимый статус.' });
  const result = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Заявка не найдена.' });
  res.json({ ok: true });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Сайт запущен на порту ${PORT}`));
