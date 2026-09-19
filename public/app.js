if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const state = { token: localStorage.getItem('gd_token'), user: JSON.parse(localStorage.getItem('gd_user') || 'null'), tab: null };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}), ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Kuch galat ho gaya');
  return data;
}

/* ---------------- LOGIN ---------------- */
document.getElementById('loginBtn').onclick = async () => {
  const name = document.getElementById('loginName').value;
  const accessCode = document.getElementById('loginCode').value;
  const errEl = document.getElementById('loginErr');
  errEl.classList.add('hidden');
  try {
    const { token, user } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ name, accessCode }) });
    state.token = token; state.user = user;
    localStorage.setItem('gd_token', token);
    localStorage.setItem('gd_user', JSON.stringify(user));
    boot();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
};

document.getElementById('logoutBtn').onclick = async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('gd_token'); localStorage.removeItem('gd_user');
  state.token = null; state.user = null;
  location.reload();
};

/* ---------------- BOOT / TABS ---------------- */
function boot() {
  if (!state.token || !state.user) return;
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('whoAmI').textContent = `${state.user.name} · ${state.user.role === 'admin' ? 'Admin' : 'Caller'}`;

  const tabs = state.user.role === 'admin'
    ? [['leads', 'Sab Leads'], ['callers', 'Callers'], ['scrape', 'Scrape'], ['import', 'Import'], ['analytics', 'Analytics'], ['bot', 'Bot']]
    : [['mine', 'Mere Leads'], ['bot', 'Bot']];

  const bar = document.getElementById('tabBar');
  bar.innerHTML = '';
  tabs.forEach(([id, label], i) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => setTab(id);
    b.id = 'tab-' + id;
    bar.appendChild(b);
    if (i === 0) setTab(id);
  });
}

function setTab(id) {
  state.tab = id;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.id === 'tab-' + id));
  const renderers = { mine: renderMine, leads: renderAllLeads, callers: renderCallers, scrape: renderScrape, import: renderImport, analytics: renderAnalytics, bot: renderBot };
  renderers[id]();
}

const STATUSES = ['assigned', 'contacted', 'interested', 'follow-up', 'closed', 'rejected'];

/* ---------------- CALLER: MY LEADS ---------------- */
async function renderMine() {
  const screen = document.getElementById('screen');
  screen.innerHTML = '<div class="empty">Loading…</div>';
  const leads = await api('/leads/mine');
  if (!leads.length) { screen.innerHTML = '<div class="empty">Abhi koi lead assign nahi hui. Naye leads aane par yahin dikhengi.</div>'; return; }
  screen.innerHTML = '';
  leads.forEach(l => screen.appendChild(leadCard(l, true)));
}

function leadCard(l, editable) {
  const div = document.createElement('div');
  div.className = 'card';
  const catLabel = (typeof CATEGORY_LABELS !== 'undefined' && CATEGORY_LABELS[l.category]) || l.category || 'General';

  const detailBits = [];
  if (l.rating) detailBits.push(`⭐ ${l.rating}${l.ratingCount ? ' (' + l.ratingCount + ')' : ''}`);
  if (l.address) detailBits.push(l.address);
  if (l.hours) detailBits.push(l.hours.split(' | ')[0]); // just today's-style first line, full text in title
  const detailsLine = detailBits.length ? `<div class="meta" title="${escapeHtml(l.hours)}">${escapeHtml(detailBits.join(' · '))}</div>` : '';
  const linkBits = [];
  if (l.website) linkBits.push(`<a href="${escapeHtml(l.website)}" target="_blank" rel="noopener">Website</a>`);
  if (l.mapsUrl) linkBits.push(`<a href="${escapeHtml(l.mapsUrl)}" target="_blank" rel="noopener">Maps</a>`);

  div.innerHTML = `
    <div class="top-row">
      <div>
        <div class="biz">${escapeHtml(l.businessName)}</div>
        <div class="meta">${escapeHtml(catLabel)}${l.city ? ' · ' + escapeHtml(l.city) : ''}</div>
        ${detailsLine}
      </div>
      <span class="status-pill ${l.status}">${l.status}</span>
    </div>
    ${editable ? `
      <div class="card-actions">
        <a href="tel:${escapeHtml(l.phone)}">📞 ${escapeHtml(l.phone)}</a>
        <select data-role="status">${STATUSES.map(s => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn-ghost toggle-btn" data-role="toggleScript" style="padding:8px 12px; font-size:13px;">📞 Script</button>
        <button class="btn-ghost toggle-btn" data-role="toggleObj" style="padding:8px 12px; font-size:13px;">🎯 Situations</button>
        ${linkBits.join('')}
      </div>
      <div class="script-panel hidden" data-role="scriptPanel"></div>
      <div class="obj-panel hidden" data-role="objPanel"></div>
      <textarea data-role="notes" placeholder="Call ke baad notes...">${escapeHtml(l.notes || '')}</textarea>
      <button class="save-note" data-role="save">Save</button>
    ` : `<div class="meta" style="margin-top:6px;">${escapeHtml(l.phone)} · ${escapeHtml(l.assignedToName || 'Unassigned')} · ${escapeHtml(l.source)}</div>
      ${linkBits.length ? `<div class="card-actions">${linkBits.join('')}</div>` : ''}`}
  `;
  if (editable) {
    const scriptPanel = div.querySelector('[data-role="scriptPanel"]');
    const objPanel = div.querySelector('[data-role="objPanel"]');

    div.querySelector('[data-role="toggleScript"]').onclick = () => {
      if (scriptPanel.classList.contains('hidden') && !scriptPanel.dataset.built) {
        scriptPanel.innerHTML = buildGrowScript(l.category, l.businessName).map(s =>
          `<div class="script-line"><div class="tag">${s.tag}</div><div class="line">${escapeHtml(s.line)}</div></div>`).join('');
        scriptPanel.dataset.built = '1';
      }
      objPanel.classList.add('hidden');
      scriptPanel.classList.toggle('hidden');
    };

    div.querySelector('[data-role="toggleObj"]').onclick = () => {
      if (objPanel.classList.contains('hidden') && !objPanel.dataset.built) {
        objPanel.innerHTML = OBJECTIONS.map(o => `<button class="obj-btn" data-obj="${o.id}">${escapeHtml(o.label)}</button>`).join('')
          + `<div class="obj-reply hidden" data-role="objReply"></div>`;
        objPanel.dataset.built = '1';
        objPanel.querySelectorAll('[data-obj]').forEach(btn => {
          btn.onclick = () => {
            const o = OBJECTIONS.find(x => x.id === btn.dataset.obj);
            const replyEl = objPanel.querySelector('[data-role="objReply"]');
            replyEl.innerHTML = `<div class="line">"${escapeHtml(o.line)}"</div>` +
              (o.notePrompt ? `<div class="hint">${escapeHtml(o.notePrompt)}</div>` : '') +
              `<button class="btn-ghost" data-role="applyObj" style="padding:6px 12px; font-size:12px; margin-top:8px;">Status ko "${o.nextStatus}" set karo</button>`;
            replyEl.classList.remove('hidden');
            replyEl.querySelector('[data-role="applyObj"]').onclick = () => {
              div.querySelector('[data-role="status"]').value = o.nextStatus;
            };
          };
        });
      }
      scriptPanel.classList.add('hidden');
      objPanel.classList.toggle('hidden');
    };

    div.querySelector('[data-role="save"]').onclick = async () => {
      const status = div.querySelector('[data-role="status"]').value;
      const notes = div.querySelector('[data-role="notes"]').value;
      await api(`/leads/${l.id}/status`, { method: 'POST', body: JSON.stringify({ status, notes }) });
      renderMine();
    };
  }
  return div;
}

/* ---------------- ADMIN: ALL LEADS ---------------- */
async function renderAllLeads() {
  const screen = document.getElementById('screen');
  screen.innerHTML = '<div class="empty">Loading…</div>';
  const leads = await api('/admin/leads');
  const box = document.createElement('div');
  box.className = 'panel-box';
  box.innerHTML = `<h3>Sab Leads (${leads.length})</h3><button class="btn-ghost" id="exportBtn">CSV Export</button>`;
  screen.innerHTML = '';
  screen.appendChild(box);
  document.getElementById('exportBtn').onclick = async () => {
    const res = await fetch('/api/admin/leads/export', { headers: { Authorization: 'Bearer ' + state.token } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'growdesk-leads.csv';
    a.click();
  };
  if (!leads.length) { screen.appendChild(elFromHtml('<div class="empty">Koi lead nahi hai abhi — Scrape ya Import tab se add karo.</div>')); return; }
  leads.forEach(l => screen.appendChild(leadCard(l, false)));
}

/* ---------------- ADMIN: CALLERS ---------------- */
async function renderCallers() {
  const screen = document.getElementById('screen');
  screen.innerHTML = '<div class="empty">Loading…</div>';
  const [callers, pool] = await Promise.all([api('/admin/callers'), api('/admin/pool')]);

  const poolBox = document.createElement('div');
  poolBox.className = 'panel-box';
  poolBox.innerHTML = `<h3>Pool</h3>
    <div class="summary-box"><b>${pool.poolSize}</b> leads abhi pool mein waiting hain.</div>
    <div class="field" style="margin-top:10px; max-width:220px;">
      <label>Har caller ki active-lead cap</label>
      <input id="capInput" type="number" value="${pool.activeCapPerCaller}" min="1">
    </div>
    <button class="btn-ghost" id="capSaveBtn" style="padding:8px 14px; font-size:13px;">Save Cap</button>
    <div class="summary-box" id="capMsg"></div>`;

  const addBox = document.createElement('div');
  addBox.className = 'panel-box';
  addBox.innerHTML = `
    <h3>Nayi Caller Add Karo</h3>
    <div class="field"><input id="newCallerName" placeholder="Caller ka naam"></div>
    <button class="btn-gold" id="addCallerBtn">Add Karo</button>
    <div id="newCallerCode"></div>
  `;

  const listBox = document.createElement('div');
  listBox.className = 'panel-box';
  listBox.innerHTML = `<h3>Sab Callers</h3>
    <table>
      <tr><th>Naam</th><th>Code</th><th>Total Leads</th><th>Closed</th><th>Status</th><th></th></tr>
      ${callers.map(c => `
        <tr>
          <td>${escapeHtml(c.name)}</td>
          <td>${c.accessCode}</td>
          <td>${c.leadCount}</td>
          <td>${c.closedCount}</td>
          <td>${c.active ? 'Active' : 'Off'}</td>
          <td><button class="btn-ghost" data-toggle="${c.id}" style="padding:5px 10px; font-size:11px;">${c.active ? 'Deactivate' : 'Activate'}</button></td>
        </tr>`).join('')}
    </table>`;

  screen.innerHTML = '';
  screen.appendChild(poolBox);
  screen.appendChild(addBox);
  screen.appendChild(listBox);

  document.getElementById('capSaveBtn').onclick = async () => {
    const cap = document.getElementById('capInput').value;
    const msgEl = document.getElementById('capMsg');
    try {
      await api('/admin/settings', { method: 'POST', body: JSON.stringify({ activeCapPerCaller: cap }) });
      msgEl.textContent = 'Saved.';
    } catch (e) {
      msgEl.textContent = e.message;
    }
  };
  document.getElementById('addCallerBtn').onclick = async () => {
    const name = document.getElementById('newCallerName').value;
    if (!name.trim()) return;
    const user = await api('/admin/callers', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('newCallerCode').innerHTML = `<div class="access-code-box">${escapeHtml(user.name)} ka access code: <div class="code">${user.accessCode}</div>Yeh isi waqt copy karke usse WhatsApp kar do — dobara yahan nahi dikhega.</div>`;
    renderCallers();
  };
  listBox.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.onclick = async () => { await api(`/admin/callers/${btn.dataset.toggle}/toggle`, { method: 'POST' }); renderCallers(); };
  });
}

/* ---------------- ADMIN: SCRAPE ---------------- */
function renderScrape() {
  const screen = document.getElementById('screen');
  const catOptions = Object.keys(CATEGORY_LABELS).filter(k => k !== 'other');
  const defaultQueries = {
    cafe: 'cafes and restaurants', caterer: 'caterers', realestate: 'real estate agents',
    b2b: 'wholesalers', clinic: 'clinics and hospitals', coaching: 'coaching institutes',
    gym: 'gyms', garage: 'car repair garages', salon: 'salons and spas', retail: 'kirana and retail stores'
  };
  screen.innerHTML = `
    <div class="panel-box">
      <h3>Budget Scrape — Sab Categories Milakar</h3>
      <div class="summary-box">Jitne categories tick karoge, unme round-robin ghoom ke leads nikalega — ek category khatam nahi hoti dusri shuru, sab saath-saath badhti hain. Jaise hi estimated cost budget ke barabar hoti hai, turant ruk jaata hai.</div>
      <div class="field" style="margin-top:10px;"><label>City</label><input id="bgCity" placeholder="e.g. Bengaluru"></div>
      <div class="field"><label>Budget (USD)</label><input id="bgBudget" type="number" value="200"></div>
      <div class="field">
        <label>Categories (query edit kar sakte ho)</label>
        <div id="bgCategoryList" style="margin-top:8px; display:flex; flex-direction:column; gap:8px;">
          ${catOptions.map(k => `
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" data-cat-check="${k}" checked style="width:auto;">
              <span style="font-size:12.5px; color:var(--text-dim); min-width:88px;">${escapeHtml(CATEGORY_LABELS[k])}</span>
              <input data-cat-query="${k}" value="${escapeHtml(defaultQueries[k] || k)}" style="flex:1; padding:8px 10px;">
            </div>`).join('')}
        </div>
      </div>
      <button class="btn-gold" id="bgScrapeBtn" style="margin-top:6px;">Budget Scrape Shuru Karo</button>
      <div class="summary-box" id="bgSummary"></div>
    </div>

    <div class="panel-box">
      <h3>Single Category Scrape</h3>
      <div class="field"><label>Kya dhoondhna hai</label><input id="scrapeQuery" placeholder="e.g. dental clinics"></div>
      <div class="field"><label>City</label><input id="scrapeCity" placeholder="e.g. Bengaluru"></div>
      <div class="field"><label>Category label (optional)</label><input id="scrapeCategory" placeholder="e.g. clinic"></div>
      <button class="btn-ghost" id="scrapeBtn">Scrape Karo</button>
      <div class="summary-box" id="scrapeSummary"></div>
    </div>

    <div class="panel-box">
      <h3>Note</h3>
      <div class="summary-box">Cost sirf ek <b>estimate</b> hai (Google ke published worst-case rates se) — tera actual free quota isse zyada bhi ho sakta hai, kam nahi. Google Places official API hai — safe hai. JustDial/Instagram ke liye <b>Import</b> tab use karo.</div>
    </div>
  `;

  document.getElementById('bgScrapeBtn').onclick = async () => {
    const city = document.getElementById('bgCity').value;
    const budgetUSD = document.getElementById('bgBudget').value;
    const categories = [];
    document.querySelectorAll('[data-cat-check]').forEach(chk => {
      if (chk.checked) {
        const key = chk.dataset.catCheck;
        const query = document.querySelector(`[data-cat-query="${key}"]`).value;
        categories.push({ key, query });
      }
    });
    const summaryEl = document.getElementById('bgSummary');
    if (!city || !categories.length) { summaryEl.textContent = 'City aur kam se kam ek category chuno'; return; }
    summaryEl.textContent = 'Scraping ho raha hai, categories ke beech ghoom raha hai… (thoda time lagega)';
    try {
      const s = await api('/admin/scrape-budget', { method: 'POST', body: JSON.stringify({ city, budgetUSD, categories }) });
      const breakdown = Object.entries(s.byCategory || {}).map(([k, v]) => `${CATEGORY_LABELS[k] || k}: ${v}`).join(', ') || 'koi nahi';
      summaryEl.innerHTML = `<b>${s.added}</b> naye leads pool mein add hue (est. cost <b>$${s.costEstimate}</b>).<br>Category-wise: ${escapeHtml(breakdown)}.<br>${s.skippedDuplicate} duplicate skip hue, ${s.skippedFamous || 0} "famous/already-set" business skip hue.<br><i>Ruka kyunki: ${escapeHtml(s.stoppedReason)}</i><br>Callers ko yeh khud-ba-khud milengi jaise-jaise unki active leads khatam hongi.`;
    } catch (e) {
      summaryEl.textContent = e.message;
    }
  };

  document.getElementById('scrapeBtn').onclick = async () => {
    const query = document.getElementById('scrapeQuery').value;
    const city = document.getElementById('scrapeCity').value;
    const category = document.getElementById('scrapeCategory').value;
    const summaryEl = document.getElementById('scrapeSummary');
    summaryEl.textContent = 'Scraping ho raha hai…';
    try {
      const s = await api('/admin/scrape', { method: 'POST', body: JSON.stringify({ query, city, category }) });
      summaryEl.innerHTML = `<b>${s.added}</b> naye leads pool mein add hue. ${s.skippedDuplicate} duplicate skip hue, ${s.skippedNoPhone} bina phone ke skip hue, ${s.skippedFamous || 0} "famous/already-set" skip hue.`;
    } catch (e) {
      summaryEl.textContent = e.message;
    }
  };
}

/* ---------------- ADMIN: IMPORT ---------------- */
function renderImport() {
  const screen = document.getElementById('screen');
  const catOptions = Object.keys(CATEGORY_LABELS);
  screen.innerHTML = `
    <div class="panel-box">
      <h3>Ek Lead Manually Add Karo</h3>
      <div class="summary-box">CSV banane ka jhanjhat nahi — bas ek lead ka detail bhar do, yeh bhi pool mein jaake wahi dedup + auto-distribute follow karega.</div>
      <div class="field" style="margin-top:10px;"><label>Business Name</label><input id="manBiz" placeholder="e.g. Sunrise Cafe"></div>
      <div class="field"><label>Phone</label><input id="manPhone" placeholder="e.g. 9876543210"></div>
      <div class="field">
        <label>Category</label>
        <select id="manCategory">${catOptions.map(k => `<option value="${k}">${escapeHtml(CATEGORY_LABELS[k])}</option>`).join('')}</select>
      </div>
      <div class="field"><label>City</label><input id="manCity" placeholder="e.g. Bengaluru"></div>
      <div class="field"><label>Address (optional)</label><input id="manAddress" placeholder="e.g. MG Road"></div>
      <button class="btn-gold" id="manAddBtn">Add Karo</button>
      <div class="summary-box" id="manSummary"></div>
    </div>

    <div class="panel-box">
      <h3>CSV Import (bulk)</h3>
      <div class="summary-box">Headers yeh hone chahiye: <b>businessName, phone, category, city, address</b>. JustDial/Instagram se manually collect kiya hua data isi format mein daal do.</div>
      <div class="field" style="margin-top:10px;"><label>Source ka naam</label><input id="importSource" placeholder="e.g. justdial-manual"></div>
      <div class="field"><label>CSV file</label><input id="importFile" type="file" accept=".csv"></div>
      <button class="btn-ghost" id="importBtn">Import Karo</button>
      <div class="summary-box" id="importSummary"></div>
    </div>
  `;

  document.getElementById('manAddBtn').onclick = async () => {
    const businessName = document.getElementById('manBiz').value.trim();
    const phone = document.getElementById('manPhone').value.trim();
    const category = document.getElementById('manCategory').value;
    const city = document.getElementById('manCity').value.trim();
    const address = document.getElementById('manAddress').value.trim();
    const summaryEl = document.getElementById('manSummary');
    if (!businessName || !phone) { summaryEl.textContent = 'Business name aur phone dono bharo'; return; }
    try {
      const s = await api('/admin/leads/manual', { method: 'POST', body: JSON.stringify({ businessName, phone, category, city, address }) });
      if (s.added) {
        summaryEl.textContent = `${businessName} pool mein add ho gaya.`;
        ['manBiz', 'manPhone', 'manCity', 'manAddress'].forEach(id => document.getElementById(id).value = '');
      } else if (s.skippedDuplicate) {
        summaryEl.textContent = 'Yeh number already system mein hai — duplicate skip ho gaya.';
      } else {
        summaryEl.textContent = 'Add nahi hua, phone number check karo.';
      }
    } catch (e) {
      summaryEl.textContent = e.message;
    }
  };

  document.getElementById('importBtn').onclick = async () => {
    const fileEl = document.getElementById('importFile');
    const summaryEl = document.getElementById('importSummary');
    if (!fileEl.files[0]) { summaryEl.textContent = 'File chuno pehle'; return; }
    const fd = new FormData();
    fd.append('file', fileEl.files[0]);
    fd.append('source', document.getElementById('importSource').value || 'manual-import');
    summaryEl.textContent = 'Importing…';
    try {
      const s = await api('/admin/import', { method: 'POST', body: fd });
      summaryEl.innerHTML = `<b>${s.added}</b> naye leads pool mein add hue. ${s.skippedDuplicate} duplicate skip hue, ${s.skippedNoPhone} bina phone ke skip hue. Callers ko khud-ba-khud milengi.`;
    } catch (e) {
      summaryEl.textContent = e.message;
    }
  };
}

/* ---------------- ADMIN: ANALYTICS ---------------- */
async function renderAnalytics() {
  const screen = document.getElementById('screen');
  screen.innerHTML = '<div class="empty">Loading…</div>';
  const s = await api('/admin/analytics');

  const overview = document.createElement('div');
  overview.className = 'panel-box';
  overview.innerHTML = `
    <h3>Overview</h3>
    <table>
      <tr><th>Total Leads</th><th>Closed</th><th>Rejected</th><th>In Progress</th><th>Pool</th><th>Conversion</th></tr>
      <tr>
        <td>${s.total}</td><td>${s.closed}</td><td>${s.rejected}</td><td>${s.inProgress}</td><td>${s.pool}</td>
        <td style="color:var(--gold); font-weight:700;">${s.overallConversion}%</td>
      </tr>
    </table>`;

  const catBox = document.createElement('div');
  catBox.className = 'panel-box';
  const catRows = Object.entries(s.byCategory).sort((a, b) => b[1].conversion - a[1].conversion);
  catBox.innerHTML = `<h3>Category-wise Conversion</h3>
    <table>
      <tr><th>Category</th><th>Total</th><th>Closed</th><th>Conversion</th></tr>
      ${catRows.map(([k, v]) => `<tr><td>${escapeHtml(CATEGORY_LABELS[k] || k)}</td><td>${v.total}</td><td>${v.closed}</td><td>${v.conversion}%</td></tr>`).join('') || '<tr><td colspan="4">Abhi koi data nahi</td></tr>'}
    </table>`;

  const callerBox = document.createElement('div');
  callerBox.className = 'panel-box';
  callerBox.innerHTML = `<h3>Caller-wise Performance</h3>
    <table>
      <tr><th>Naam</th><th>Total</th><th>Closed</th><th>Conversion</th></tr>
      ${s.byCaller.map(c => `<tr><td>${escapeHtml(c.name)}${!c.active ? ' (off)' : ''}</td><td>${c.total}</td><td>${c.closed}</td><td>${c.conversion}%</td></tr>`).join('') || '<tr><td colspan="4">Koi caller nahi</td></tr>'}
    </table>`;

  screen.innerHTML = '';
  screen.appendChild(overview);
  screen.appendChild(catBox);
  screen.appendChild(callerBox);
}

/* ---------------- BOT ---------------- */
let botHistory = [];
function renderBot() {
  const screen = document.getElementById('screen');
  screen.innerHTML = `
    <div class="panel-box">
      <h3>🤖 GrowDesk Bot</h3>
      <div class="summary-box">Sirf GrowDesk ke services, pricing aur policy ke baare mein poochho — jaise "client ko website aur WhatsApp bot dono chahiye, price kya hoga?"</div>
      <div id="botMessages" style="margin-top:12px; display:flex; flex-direction:column; gap:8px; max-height:50vh; overflow-y:auto;"></div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <input id="botInput" placeholder="Apna sawal likho..." style="flex:1; background:var(--bg-alt); border:1px solid var(--edge); color:var(--text); padding:10px 12px; border-radius:8px;">
        <button class="btn-gold" id="botSendBtn">Bhejo</button>
      </div>
    </div>
  `;
  const msgBox = document.getElementById('botMessages');
  botHistory.forEach(m => msgBox.appendChild(botBubble(m.role, m.content)));
  msgBox.scrollTop = msgBox.scrollHeight;

  const send = async () => {
    const input = document.getElementById('botInput');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    msgBox.appendChild(botBubble('user', question));
    const thinking = botBubble('assistant', 'Sochte hain…');
    msgBox.appendChild(thinking);
    msgBox.scrollTop = msgBox.scrollHeight;
    try {
      const { answer } = await api('/bot/ask', { method: 'POST', body: JSON.stringify({ question, history: botHistory }) });
      thinking.textContent = answer;
      botHistory.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    } catch (e) {
      thinking.textContent = e.message;
    }
    msgBox.scrollTop = msgBox.scrollHeight;
  };
  document.getElementById('botSendBtn').onclick = send;
  document.getElementById('botInput').onkeydown = (e) => { if (e.key === 'Enter') send(); };
}

function botBubble(role, text) {
  const div = document.createElement('div');
  const isUser = role === 'user';
  div.style.cssText = `align-self:${isUser ? 'flex-end' : 'flex-start'}; max-width:85%; background:${isUser ? 'var(--gold)' : 'var(--surface-2)'}; color:${isUser ? '#1A1200' : 'var(--text)'}; padding:9px 13px; border-radius:12px; font-size:13.5px; line-height:1.5; white-space:pre-wrap;`;
  div.textContent = text;
  return div;
}

/* ---------------- helpers ---------------- */
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function elFromHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }

boot();
