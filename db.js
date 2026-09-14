const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { inferCategory } = require('./categoryMap');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

function loadRaw() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      users: [
        // First admin account — change the access code after first login.
        { id: crypto.randomUUID(), name: 'Admin', accessCode: 'ADMIN01', role: 'admin', active: true, createdAt: new Date().toISOString() }
      ],
      leads: [],
      sessions: {}, // token -> { userId, createdAt } — persisted so logins survive a server restart
      settings: { activeCapPerCaller: 5 }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // Migration for db.json files created before sessions/settings existed.
  let dirty = false;
  if (!data.sessions) { data.sessions = {}; dirty = true; }
  if (!data.settings) { data.settings = { activeCapPerCaller: 5 }; dirty = true; }
  if (dirty) save(data);
  return data;
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Normalize an Indian phone number to its last 10 digits so the same
// business can't enter the pool twice under +91, 0-prefixed, or spaced formats.
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits || null;
}

function genAccessCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Default active-lead cap per caller, used only until settings.activeCapPerCaller
// exists in db.json (see loadRaw's migration) — from then on the admin controls
// this from the Callers tab and it's read fresh out of `data.settings` every call.
const ACTIVE_STATUSES = ['assigned', 'contacted', 'interested', 'follow-up'];

// Inserts leads with a hard duplicate guard on normalized phone number.
// Leads land in the shared pool (status 'new', unassigned) — nobody gets
// handed a batch just because a scrape ran. See topUpCaller() for how they
// actually reach a caller.
function ingestLeads(data, rawLeads, source) {
  const existingPhones = new Set(data.leads.map(l => l.phoneNormalized).filter(Boolean));
  let added = 0, skippedDuplicate = 0, skippedNoPhone = 0;

  for (const raw of rawLeads) {
    const phoneNormalized = normalizePhone(raw.phone);
    if (!phoneNormalized) { skippedNoPhone++; continue; }
    if (existingPhones.has(phoneNormalized)) { skippedDuplicate++; continue; }

    const category = raw.category || inferCategory({ types: raw.types || [], text: `${raw.businessName || ''} ${source}` });

    data.leads.push({
      id: crypto.randomUUID(),
      businessName: raw.businessName || 'Unknown',
      phone: raw.phone,
      phoneNormalized,
      category,
      city: raw.city || '',
      address: raw.address || '',
      // Extra context when a scrape source has it — left blank for CSV imports
      // that don't provide it, and simply not shown on the lead card then.
      rating: raw.rating || null,
      ratingCount: raw.ratingCount || null,
      website: raw.website || '',
      hours: raw.hours || '',
      mapsUrl: raw.mapsUrl || '',
      source,
      status: 'new',
      notes: '',
      assignedTo: null,
      assignedAt: null,
      createdAt: new Date().toISOString()
    });

    existingPhones.add(phoneNormalized);
    added++;
  }

  return { added, skippedDuplicate, skippedNoPhone };
}

// Pulls a caller up to her active-lead cap from the shared pool — oldest
// unassigned lead first. Call this whenever a caller might have room: when
// she opens her list, and right after one of her leads is closed/rejected.
// A lead only ever gets touched by one topUpCaller call because assignment
// happens synchronously against the in-memory `data` object the route
// already loaded — there's no separate read-then-write race within one
// request. Returns the leads that were newly handed to her (for logging/UI).
function topUpCaller(data, callerId) {
  const cap = data.settings?.activeCapPerCaller || 5;
  let activeCount = data.leads.filter(l => l.assignedTo === callerId && ACTIVE_STATUSES.includes(l.status)).length;
  const newlyAssigned = [];
  while (activeCount < cap) {
    const next = data.leads.find(l => l.status === 'new' && !l.assignedTo);
    if (!next) break; // pool is empty — nothing more to hand out right now
    next.assignedTo = callerId;
    next.assignedAt = new Date().toISOString();
    next.status = 'assigned';
    newlyAssigned.push(next);
    activeCount++;
  }
  return newlyAssigned;
}

// How many leads are still sitting in the pool, unclaimed by anyone.
function poolSize(data) {
  return data.leads.filter(l => l.status === 'new' && !l.assignedTo).length;
}

// Everything the admin's Analytics tab shows. Kept as one function so the
// route stays a one-liner and the definition of "conversion rate" lives in
// exactly one place.
function computeStats(data) {
  const leads = data.leads;
  const total = leads.length;
  const closed = leads.filter(l => l.status === 'closed').length;
  const rejected = leads.filter(l => l.status === 'rejected').length;
  const inProgress = leads.filter(l => ACTIVE_STATUSES.includes(l.status)).length;
  const pool = poolSize(data);
  const overallConversion = total ? Math.round((closed / total) * 1000) / 10 : 0;

  const byCategory = {};
  leads.forEach(l => {
    const k = l.category || 'other';
    byCategory[k] = byCategory[k] || { total: 0, closed: 0 };
    byCategory[k].total++;
    if (l.status === 'closed') byCategory[k].closed++;
  });
  Object.values(byCategory).forEach(c => { c.conversion = c.total ? Math.round((c.closed / c.total) * 1000) / 10 : 0; });

  const byCaller = data.users.filter(u => u.role === 'caller').map(c => {
    const mine = leads.filter(l => l.assignedTo === c.id);
    const closedByHer = mine.filter(l => l.status === 'closed').length;
    return {
      id: c.id, name: c.name, active: c.active,
      total: mine.length, closed: closedByHer,
      conversion: mine.length ? Math.round((closedByHer / mine.length) * 1000) / 10 : 0
    };
  }).sort((a, b) => b.conversion - a.conversion);

  return { total, closed, rejected, inProgress, pool, overallConversion, byCategory, byCaller };
}

function getSettings(data) {
  return data.settings || { activeCapPerCaller: 5 };
}

function updateSettings(data, patch) {
  data.settings = { ...getSettings(data), ...patch };
  return data.settings;
}

module.exports = {
  loadRaw, save, normalizePhone, genAccessCode, ingestLeads, topUpCaller, poolSize,
  computeStats, getSettings, updateSettings
};
