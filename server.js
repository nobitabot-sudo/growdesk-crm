require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { scrapeGooglePlaces, scrapeCategoriesWithBudget } = require('./scrapers/googlePlaces');
const { BUSINESS_KNOWLEDGE } = require('./businessKnowledge');

const app = express();
const upload = multer();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- sessions, persisted alongside everything else in db.js (Postgres if
// DATABASE_URL is set, else the local JSON file) — data.sessions:
// token -> {userId, createdAt}. No expiry by design — callers stay logged in
// until the admin deactivates them or someone explicitly logs out. ----
function auth(requiredRole) {
  return async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const data = await db.loadRaw();
      const session = data.sessions[token];
      if (!session) return res.status(401).json({ error: 'Not logged in' });
      const user = data.users.find(u => u.id === session.userId && u.active);
      if (!user) return res.status(401).json({ error: 'Session invalid' });
      if (requiredRole && user.role !== requiredRole) return res.status(403).json({ error: 'Not allowed' });
      req.user = user;
      req.data = data;
      req.token = token;
      next();
    } catch (err) {
      res.status(500).json({ error: 'Database error: ' + err.message });
    }
  };
}

// ================= AUTH =================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { name, accessCode } = req.body;
    const data = await db.loadRaw();
    const user = data.users.find(
      u => u.active && u.accessCode === String(accessCode || '').toUpperCase().trim()
        && u.name.toLowerCase() === String(name || '').toLowerCase().trim()
    );
    if (!user) return res.status(401).json({ error: 'Naam ya access code galat hai' });
    const token = crypto.randomBytes(24).toString('hex');
    data.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    await db.save(data);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/api/auth/logout', auth(), async (req, res) => {
  delete req.data.sessions[req.token];
  await db.save(req.data);
  res.json({ ok: true });
});

// ================= CALLER =================
app.get('/api/leads/mine', auth(), async (req, res) => {
  const data = req.data;
  db.topUpCaller(data, req.user.id);
  await db.save(data);
  const mine = data.leads
    .filter(l => l.assignedTo === req.user.id)
    .sort((a, b) => (a.assignedAt < b.assignedAt ? 1 : -1));
  res.json(mine);
});

app.post('/api/leads/:id/status', auth(), async (req, res) => {
  const { status, notes } = req.body;
  const data = req.data;
  const lead = data.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (lead.assignedTo !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Yeh lead aapko assign nahi hai' });
  }
  if (status) lead.status = status;
  if (notes !== undefined) lead.notes = notes;
  if (status === 'closed' || status === 'rejected') {
    db.topUpCaller(data, lead.assignedTo);
  }
  await db.save(data);
  res.json(lead);
});

// ================= ADMIN: CALLERS =================
app.get('/api/admin/callers', auth('admin'), (req, res) => {
  const callers = req.data.users.filter(u => u.role === 'caller').map(c => ({
    ...c,
    leadCount: req.data.leads.filter(l => l.assignedTo === c.id).length,
    closedCount: req.data.leads.filter(l => l.assignedTo === c.id && l.status === 'closed').length
  }));
  res.json(callers);
});

app.post('/api/admin/callers', auth('admin'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name chahiye' });
  const data = req.data;
  const accessCode = db.genAccessCode();
  const user = {
    id: crypto.randomUUID(), name: name.trim(), accessCode, role: 'caller',
    active: true, createdAt: new Date().toISOString()
  };
  data.users.push(user);
  await db.save(data);
  res.json(user); // access code is only ever shown here — copy it to the caller now
});

app.post('/api/admin/callers/:id/toggle', auth('admin'), async (req, res) => {
  const data = req.data;
  const user = data.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  user.active = !user.active;
  await db.save(data);
  res.json(user);
});

app.get('/api/admin/pool', auth('admin'), (req, res) => {
  res.json({ poolSize: db.poolSize(req.data), activeCapPerCaller: db.getSettings(req.data).activeCapPerCaller });
});

app.get('/api/admin/settings', auth('admin'), (req, res) => {
  res.json(db.getSettings(req.data));
});

app.post('/api/admin/settings', auth('admin'), async (req, res) => {
  const cap = Number(req.body.activeCapPerCaller);
  if (!cap || cap < 1) return res.status(400).json({ error: 'Valid cap (1+) chahiye' });
  const data = req.data;
  const settings = db.updateSettings(data, { activeCapPerCaller: cap });
  await db.save(data);
  res.json(settings);
});

app.get('/api/admin/analytics', auth('admin'), (req, res) => {
  res.json(db.computeStats(req.data));
});

// ================= ADMIN: LEADS =================
app.get('/api/admin/leads', auth('admin'), (req, res) => {
  const withNames = req.data.leads.map(l => ({
    ...l,
    assignedToName: req.data.users.find(u => u.id === l.assignedTo)?.name || '—'
  })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(withNames);
});

app.get('/api/admin/leads/export', auth('admin'), (req, res) => {
  const rows = [['Business', 'Phone', 'Category', 'City', 'Source', 'Status', 'Assigned To', 'Created']];
  req.data.leads.forEach(l => rows.push([
    l.businessName, l.phone, l.category, l.city, l.source, l.status,
    req.data.users.find(u => u.id === l.assignedTo)?.name || '', l.createdAt
  ]));
  const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="growdesk-leads.csv"');
  res.send(csv);
});

// Manually add one lead from the admin panel — same dedup + pool logic as
// scrape/import, just for the "I have one lead, typing CSVs is overkill" case.
app.post('/api/admin/leads/manual', auth('admin'), async (req, res) => {
  const { businessName, phone, category, city, address } = req.body;
  if (!businessName || !phone) return res.status(400).json({ error: 'Business name aur phone dono chahiye' });
  const data = req.data;
  const summary = db.ingestLeads(data, [{ businessName, phone, category, city, address }], 'manual-admin');
  await db.save(data);
  res.json(summary);
});

// Live scrape via Google Places — the one ToS-safe automated source.
app.post('/api/admin/scrape', auth('admin'), async (req, res) => {
  const { query, city, category } = req.body;
  if (!query || !city) return res.status(400).json({ error: 'Query aur city dono chahiye' });
  try {
    const { leads: rawLeads, skippedFamous } = await scrapeGooglePlaces(query, city, category);
    const data = req.data;
    const summary = db.ingestLeads(data, rawLeads, `google:${query}`);
    await db.save(data);
    res.json({ ...summary, skippedFamous });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Budget-capped, interleaved across categories — stops the moment estimated
// spend would exceed budgetUSD, so a run left unattended can't blow past it.
// categories: [{ key: 'cafe', query: 'cafes and restaurants' }, ...]
app.post('/api/admin/scrape-budget', auth('admin'), async (req, res) => {
  const { city, budgetUSD, categories } = req.body;
  if (!city || !Array.isArray(categories) || !categories.length) {
    return res.status(400).json({ error: 'City aur kam se kam ek category chahiye' });
  }
  const budget = Number(budgetUSD);
  if (!budget || budget <= 0) return res.status(400).json({ error: 'Valid budget (USD) chahiye' });
  try {
    const result = await scrapeCategoriesWithBudget(categories, city, budget);
    const data = req.data;
    const summary = db.ingestLeads(data, result.leads, `google:budget:${city}`);
    await db.save(data);
    res.json({ ...summary, costEstimate: result.costEstimate, byCategory: result.byCategory, skippedFamous: result.skippedFamous, stoppedReason: result.stoppedReason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSV import — the intended route for JustDial/Instagram/manually-collected leads.
// Expected headers: businessName,phone,category,city,address
app.post('/api/admin/import', auth('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file chahiye' });
  const source = req.body.source || 'manual-import';
  try {
    const records = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    const data = req.data;
    const summary = db.ingestLeads(data, records, source);
    await db.save(data);
    res.json(summary);
  } catch (err) {
    res.status(400).json({ error: 'CSV parse nahi hua: ' + err.message });
  }
});

// ================= BOT =================
// A small Q&A assistant scoped to businessKnowledge.js ONLY — for callers to
// check mid-call ("client wants X + Y, what's the price?") without needing
// to interrupt an admin. Any logged-in user (caller or admin) can use it.
const BOT_SYSTEM_PROMPT = `You are GrowDesk's internal assistant for telecallers and admin staff.
Answer ONLY using the business information below. Keep answers short and practical —
callers may be using this mid-call. Reply in the same mix of Hindi/English (Hinglish)
the question is asked in, unless asked to answer only in English.
If something isn't covered by this information (an unusual custom request, a discount,
a specific ongoing client's deal), say plainly that it's not something you can confirm
and that they should check with the admin — never invent a price, policy, or discount
that isn't listed below.

${BUSINESS_KNOWLEDGE}`;

app.post('/api/bot/ask', auth(), async (req, res) => {
  const { question, history } = req.body;
  if (!question || !question.trim()) return res.status(400).json({ error: 'Sawal likho pehle' });
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY set nahi hai server pe. Admin ko bolo environment variable add kare (console.groq.com se free milti hai, no card).' });
  }
  try {
    // Groq's API is OpenAI-compatible — plain {role, content} messages, role
    // names 'user'/'assistant' match what we already store, no remapping needed.
    const priorTurns = (Array.isArray(history) ? history : []).slice(-10).map(m => ({ role: m.role, content: m.content }));
    const messages = [
      { role: 'system', content: BOT_SYSTEM_PROMPT },
      ...priorTurns,
      { role: 'user', content: question }
    ];

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({ model, messages, max_tokens: 500 })
    });
    const data = await apiRes.json();
    if (!apiRes.ok) throw new Error(data.error?.message || 'Bot se jawab nahi mila');
    const answer = data.choices?.[0]?.message?.content?.trim() || 'Jawab nahi mila, dobara try karo.';
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GrowDesk CRM running on port ${PORT}`));
