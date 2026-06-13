/* ============================================================
   INSIGHT // Console — SPA front-end
   ============================================================ */

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

// =====================================================================
// STATE
// =====================================================================
const state = {
  // per-tool data
  pulse:    { data: null, tab: 'all',        query: '' },
  velocity: { data: null, tab: 'composite',  query: '' },
  lab:      { data: null, tab: 'papers',    query: '' },
  weights:  { data: null, tab: 'models',    query: '' },
  history:  { data: null, snapshots: [], kinds: [], filter: 'all' },
  digest:   { content: '', date: '' },

  // global
  route: '#/',
  i18n: { en: {}, 'zh-CN': {} },
  lang: 'zh-CN',
  theme: 'dark',
  accent: 'amber',
  bookmarks: { news: new Set(), github: new Set(), papers: new Set() },
};

// =====================================================================
// PERSISTENCE (preferences + bookmarks)
// =====================================================================
const PREFS_KEY = 'insight_prefs_v1';
const BK_KEY = 'insight_bookmarks_v1';

const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
};
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      lang: state.lang, theme: state.theme, accent: state.accent,
    }));
  } catch {}
};
const loadBookmarks = () => {
  try {
    const o = JSON.parse(localStorage.getItem(BK_KEY) || '{}');
    return {
      news: new Set(o.news || []),
      github: new Set(o.github || []),
      papers: new Set(o.papers || []),
    };
  } catch { return { news: new Set(), github: new Set(), papers: new Set() }; }
};
const persistBookmarks = () => {
  try {
    localStorage.setItem(BK_KEY, JSON.stringify({
      news: Array.from(state.bookmarks.news),
      github: Array.from(state.bookmarks.github),
      papers: Array.from(state.bookmarks.papers),
    }));
  } catch {}
};

// initial
const initialPrefs = loadPrefs();
state.lang = initialPrefs.lang || 'zh-CN';
state.theme = initialPrefs.theme || 'dark';
state.accent = initialPrefs.accent || 'amber';
state.bookmarks = loadBookmarks();

// =====================================================================
// I18N
// =====================================================================
const t = (key, fallback) => {
  const dict = state.i18n[state.lang] || state.i18n['en'] || {};
  return dict[key] || fallback || key;
};
async function loadI18n() {
  for (const lang of [state.lang, state.lang === 'zh-CN' ? 'en' : 'zh-CN']) {
    if (state.i18n[lang] && Object.keys(state.i18n[lang]).length) continue;
    try {
      const r = await fetch(`/api/i18n/${lang}`);
      const j = await r.json();
      if (j.ok) state.i18n[lang] = j.strings;
    } catch {}
  }
  applyI18n();
}
function applyI18n() {
  $$('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const v = t(key);
    if (v && v !== key) el.textContent = v;
  });
  // lang switch active
  $$('.lang-btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === state.lang));
  // html lang
  document.documentElement.lang = state.lang;
}

// =====================================================================
// THEME / ACCENT
// =====================================================================
const ACCENT_PALETTES = {
  amber:  { name: 'Amber',   color: '#f5a524', color2: '#ffc857' },
  signal: { name: 'Signal',  color: '#4ade80', color2: '#22d3ee' },
  violet: { name: 'Violet',  color: '#b794f6', color2: '#8b5cf6' },
  coral:  { name: 'Coral',   color: '#ff7a59', color2: '#fb7185' },
};
const ACCENT_CYCLE = ['amber', 'signal', 'violet', 'coral'];

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
function applyAccent() {
  const a = ACCENT_PALETTES[state.accent] || ACCENT_PALETTES.amber;
  const r = document.documentElement;
  r.dataset.accent = state.accent;
  r.style.setProperty('--accent', a.color);
  r.style.setProperty('--accent-2', a.color2);
  const isLight = state.theme === 'light';
  r.style.setProperty('--accent-soft', isLight ? hexA(a.color, 0.12) : hexA(a.color, 0.12));
  r.style.setProperty('--accent-line', hexA(a.color, 0.32));
  // gh accent always gold
  r.style.setProperty('--gold', state.accent === 'amber' ? '#f6c453' : a.color);
  r.style.setProperty('--gold-soft', hexA(state.accent === 'amber' ? '#f6c453' : a.color, 0.12));
  r.style.setProperty('--gold-line', hexA(state.accent === 'amber' ? '#f6c453' : a.color, 0.32));
  // button focus dot
  const dot = $('.accent-dot');
  if (dot) dot.style.background = a.color;
}
function hexA(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  applyAccent();
  savePrefs();
  // refresh views so dark/light styles re-apply
  render();
}
function cycleAccent() {
  const i = ACCENT_CYCLE.indexOf(state.accent);
  state.accent = ACCENT_CYCLE[(i + 1) % ACCENT_CYCLE.length];
  applyAccent();
  savePrefs();
}

// =====================================================================
// API
// =====================================================================
async function api(path, opts={}) {
  try {
    const r = await fetch(path, { headers: {'Content-Type': 'application/json'}, ...opts });
    let j = {}; try { j = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { message: String(e) } }; }
}

// =====================================================================
// UTILS
// =====================================================================
const escapeHtml = s => s == null ? '' : String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
function timeAgo(iso) {
  if (!iso) return { rel: '—', cls: 'stale', exact: '' };
  const d = new Date(iso); if (isNaN(d.getTime())) return { rel: '—', cls: 'stale', exact: '' };
  const diff = (Date.now() - d.getTime()) / 1000;
  let rel, cls = 'stale';
  if (diff < 60) { rel = 'now'; cls = 'fresh'; }
  else if (diff < 3600) { rel = Math.floor(diff/60) + 'm'; cls = 'fresh'; }
  else if (diff < 86400) { rel = Math.floor(diff/3600) + 'h'; cls = 'fresh'; }
  else if (diff < 86400*7) rel = Math.floor(diff/86400) + 'd';
  else if (diff < 86400*30) rel = Math.floor(diff/(86400*7)) + 'w';
  else rel = Math.floor(diff/(86400*30)) + 'mo';
  return { rel, cls, exact: d.toISOString().replace('T',' ').slice(0,16)+'Z' };
}
const fmtNumber = n => {
  if (n == null) return '—';
  n = Number(n);
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
  return String(n);
};
const LANG_COLORS = {
  Python:'#3572A5', JavaScript:'#f1e05a', TypeScript:'#3178c6',
  Go:'#00ADD8', Rust:'#dea584', Java:'#b07219', 'C++':'#f34b7d',
  'C#':'#178600', C:'#555555', Shell:'#89e051', Swift:'#F05138',
  Kotlin:'#A97BFF', Ruby:'#701516', PHP:'#4F5D95', HTML:'#e34c26',
  CSS:'#563d7c', Lua:'#000080', Dart:'#00B4AB', Jupyter:'#DA5B0B',
  R:'#198CE7', TypeScript:'#3178c6',
};
const langColor = n => LANG_COLORS[n] || '#8b94a7';

// =====================================================================
// TOAST / STATUS / PROGRESS
// =====================================================================
let toastTimer = null;
function showToast(msg, type='') {
  const el = $('#toast');
  $('.toast-msg', el).textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + type; }, 2600);
}
function setStatus(state_, label) {
  const el = $('#status');
  el.dataset.state = state_;
  $('#statusLabel').textContent = label;
}
function setProgress(visible, label) {
  const el = $('#progress');
  el.hidden = !visible;
  if (label) $('#progressLabel').textContent = label;
}

// =====================================================================
// CLOCK
// =====================================================================
function startClock() {
  const tick = () => {
    const d = new Date();
    $('.clock-hm').textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    $('.clock-s').textContent  = String(d.getSeconds()).padStart(2,'0');
  };
  tick();
  setInterval(tick, 1000);
}

// =====================================================================
// DATA LOADERS
// =====================================================================
async function loadPulse() {
  const { ok, json } = await api('/api/ai-daily/data');
  if (ok) { state.pulse.data = json.data; return true; }
  return false;
}
async function loadVelocity() {
  const { ok, json } = await api('/api/github/data');
  if (ok) { state.velocity.data = json.data; return true; }
  return false;
}
async function loadLab() {
  const { ok, json } = await api('/api/arxiv/data');
  if (ok) { state.lab.data = json.data; return true; }
  return false;
}
async function loadWeights() {
  const { ok, json } = await api('/api/hf/data');
  if (ok) { state.weights.data = json.data; return true; }
  return false;
}
async function loadHistory() {
  const { ok, json } = await api('/api/history');
  if (ok) { state.history.kinds = json.kinds || []; state.history.snapshots = json.snapshots || []; return true; }
  return false;
}
async function loadDigest() {
  const { ok, json } = await api('/api/digest/latest');
  if (ok) { state.digest.content = json.content; state.digest.date = json.date; return true; }
  return false;
}

// =====================================================================
// ROUTER
// =====================================================================
const PAGES = {
  '#/':           { name: 'home',     render: renderHome,     loader: () => Promise.all([loadPulse(), loadVelocity(), loadLab(), loadWeights()]) },
  '#/pulse':      { name: 'pulse',    render: renderPulse,    loader: loadPulse },
  '#/velocity':   { name: 'velocity', render: renderVelocity,loader: loadVelocity },
  '#/lab':        { name: 'lab',      render: renderLab,      loader: loadLab },
  '#/weights':    { name: 'weights',  render: renderWeights,  loader: loadWeights },
  '#/history':    { name: 'history',  render: renderHistory,  loader: loadHistory },
  '#/digest':     { name: 'digest',   render: renderDigest,   loader: loadDigest },
  '#/settings':   { name: 'settings', render: renderSettings, loader: async () => {} },
};

async function route() {
  const hash = location.hash || '#/';
  const page = PAGES[hash] || PAGES['#/'];
  state.route = hash;
  // update topnav active
  $$('#topnav .topnav-item').forEach(a => a.classList.toggle('active', a.dataset.route === hash));
  setStatus('busy', t('status.busy', 'Working'));
  setProgress(true, t('status.busy', 'Working'));
  try { await page.loader(); } catch (e) {}
  setProgress(false);
  setStatus('ready', t('status.ready', 'Ready'));
  page.render();
  applyI18n();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function navigate(hash) {
  if (location.hash === hash) {
    route();
  } else {
    location.hash = hash;
  }
}

window.addEventListener('hashchange', route);

// =====================================================================
// RENDER — HOME
// =====================================================================
async function renderHome() {
  const v = $('#view');
  const totalSources = (state.pulse.data?.total_sources || 0);
  const lastIngest = state.pulse.data?.generated_at || state.lab.data?.generated_at || state.velocity.data?.generated_at || null;
  const lastIngestStr = lastIngest ? new Date(lastIngest).toLocaleString() : '—';
  const bookmarksCount = state.bookmarks.news.size + state.bookmarks.github.size + state.bookmarks.papers.size;

  v.innerHTML = `
    <section class="masthead">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span data-i18n="home.title">Tools for the curious engineer</span>
          </h1>
          <p class="mast-sub" data-i18n="home.deck">
            Four live data feeds, one screen. Every tool runs on its own scheduler; nothing here is curated by an algorithm you can't inspect.
          </p>
          <div class="home-cta">
            <button class="btn btn-primary" id="homeRunAll">
              <span class="btn-label" data-i18n="home.cta.run">Run all</span>
              <span class="btn-arrow">↗</span>
            </button>
            <a class="btn btn-ghost" href="#/settings" data-i18n="nav.settings">Settings</a>
          </div>
        </div>
        <aside class="mast-right">
          <dl class="mast-stats">
            <div><dt data-i18n="home.stats.sources">Total sources</dt><dd>${totalSources || '—'}</dd></div>
            <div><dt data-i18n="home.stats.last_ingest">Last ingest</dt><dd>${escapeHtml(lastIngestStr)}</dd></div>
            <div><dt data-i18n="home.stats.bookmarks">Bookmarks</dt><dd>${bookmarksCount}</dd></div>
            <div><dt data-i18n="home.stats.bias">Editorial bias</dt><dd>none</dd></div>
          </dl>
        </aside>
      </div>
    </section>
    <section class="grid grid-tools">
      ${toolCard('pulse', '01', state.pulse.data)}
      ${toolCard('velocity', '02', state.velocity.data)}
      ${toolCard('lab', '03', state.lab.data)}
      ${toolCard('weights', '04', state.weights.data)}
      ${toolCard('digest', '05', null, { isSpecial: true })}
      ${toolCard('history', '06', null, { isSpecial: true })}
      ${toolCardPlaceholder('arxiv-news', '07', 'AI x arXiv cross-cut')}
      ${toolCardPlaceholder('hn', '08', 'Hacker News deep cuts')}
    </section>
  `;
  applyI18n();
  $('#homeRunAll').addEventListener('click', async () => {
    setStatus('busy', t('status.busy'));
    setProgress(true, t('status.busy'));
    api('/api/ai-daily', { method: 'POST' });
    api('/api/github',   { method: 'POST' });
    api('/api/arxiv',    { method: 'POST' });
    api('/api/hf',       { method: 'POST' });
    showToast(t('toast.started', 'Started'));
    setTimeout(() => {
      setProgress(false);
      setStatus('ready', t('status.ready'));
      navigate(location.hash);  // re-render with fresh data
    }, 5000);
  });
  $$('.tool-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // If they clicked a Run button, do not navigate
      if (e.target.closest('.tool-cta-run')) {
        const route = card.dataset.route;
        e.preventDefault();
        e.stopPropagation();
        runTool(route);
        return;
      }
    });
  });
}

function toolCard(kind, num, data, opts = {}) {
  const route = `#/${kind}`;
  const meta = TOOL_META[kind];
  const dataState = data ? 'live' : 'idle';
  const lastLine = data
    ? `${fmtNumber(data.total_unique || data.total || data.unique_repo_count || (data.papers||data.models||[]).length)} items · ${new Date(data.generated_at).toLocaleTimeString()}`
    : '— no data yet';
  const statusLabel = data ? t('status.ready') : t('status.idle', 'Idle');
  return `
    <a class="tool-card tool-card-${kind} ${opts.isSpecial ? 'is-special' : ''}" data-route="${route}" href="${route}">
      <div class="tool-tick"></div>
      <header class="tool-head">
        <span class="tool-num">${num}</span>
        <span class="tool-status" data-state="${dataState}">${escapeHtml(statusLabel)}</span>
      </header>
      <h3 class="tool-name" data-i18n="tool.${kind}.name">${escapeHtml(meta.name)}</h3>
      <p class="tool-desc" data-i18n="tool.${kind}.desc">${escapeHtml(meta.desc)}</p>
      <p class="tool-long" data-i18n="tool.${kind}.long">${escapeHtml(meta.long)}</p>
      <footer class="tool-foot">
        <span class="tool-last">${escapeHtml(lastLine)}</span>
        <div class="tool-actions">
          ${data ? `<span class="tool-cta-open" data-i18n="home.cta.open">Open</span>` : ''}
          ${!opts.isSpecial ? `<button class="tool-cta-run" type="button" data-i18n="home.cta.run">Run now</button>` : ''}
        </div>
      </footer>
    </a>`;
}

function toolCardPlaceholder(kind, num, desc) {
  return `
    <a class="tool-card tool-card-placeholder" href="#/settings" data-kind="${kind}">
      <div class="tool-tick"></div>
      <header class="tool-head">
        <span class="tool-num">${num}</span>
        <span class="tool-status" data-state="upcoming" data-i18n="misc.upcoming">Coming soon</span>
      </header>
      <h3 class="tool-name">${escapeHtml(desc)}</h3>
      <p class="tool-desc" data-i18n="misc.upcoming.body">This slot is reserved for future tools.</p>
      <footer class="tool-foot">
        <span class="tool-last mono">— — —</span>
      </footer>
    </a>`;
}

const TOOL_META = {
  pulse:    { name: 'AI Pulse',    desc: 'Multi-source RSS digest', long: 'Aggregates 15 RSS feeds. Items are ranked by AI-relevance × recency × source-authority. Stories that surface in 2+ sources are clustered and flagged.' },
  velocity: { name: 'Code Velocity', desc: 'GitHub trending + REST', long: 'Two-track. Scrapes github.com/trending for the official daily/weekly/monthly cuts. Cross-checks with the REST search index for recent and active repos.' },
  lab:      { name: 'From the Lab',  desc: 'arXiv cs.AI / cs.CL / cs.LG', long: 'Latest submissions from arXiv. The first place new ideas appear — usually 2–6 weeks before they hit the press.' },
  weights:  { name: 'Open Weights',  desc: 'HuggingFace trending', long: 'Trending models, datasets, and daily papers on HuggingFace. The live signal for what the open-source community is shipping right now.' },
  digest:   { name: 'Daily Digest',  desc: 'Markdown briefing', long: 'A single, sharable Markdown report that combines the day\'s AI Pulse, Code Velocity, lab papers, and trending models. One file, one email.' },
  history:  { name: 'Snapshots',     desc: 'Browse archived ingests', long: 'Every ingest is archived locally as a JSON snapshot. Browse, open, or re-ingest from the history page.' },
};

async function runTool(route) {
  const api_map = {
    '#/pulse':    '/api/ai-daily',
    '#/velocity': '/api/github',
    '#/lab':      '/api/arxiv',
    '#/weights':  '/api/hf',
  };
  const ep = api_map[route];
  if (!ep) { navigate(route); return; }
  setStatus('busy', t('status.busy'));
  setProgress(true, t('status.busy'));
  showToast(t('toast.started'));
  await api(ep, { method: 'POST' });
  // simple poll
  setTimeout(async () => {
    setProgress(false);
    setStatus('ready', t('status.ready'));
    showToast(t('toast.complete'), 'success');
    navigate(route);
  }, 6000);
}

// =====================================================================
// RENDER — TOOL PAGE (shared shell)
// =====================================================================
function renderToolPage(opts) {
  const v = $('#view');
  v.innerHTML = `
    <section class="masthead masthead-tool">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span class="tool-num" style="color:var(--accent)">${opts.num}</span>
            <span data-i18n="tool.${opts.kind}.name">${escapeHtml(opts.title)}</span>
          </h1>
          <p class="mast-sub" data-i18n="tool.${opts.kind}.long">${escapeHtml(opts.long)}</p>
        </div>
        <aside class="mast-right">
          <div class="tool-ctas">
            <button class="btn btn-ghost" id="reloadBtn" type="button" data-i18n="action.reload">Re-read cache</button>
            ${opts.canIngest ? `<button class="btn btn-primary" id="ingestBtn" type="button">
              <span class="btn-label" data-i18n="action.ingest">Ingest now</span>
              <span class="btn-arrow">↗</span>
              <span class="btn-spinner"></span>
            </button>` : ''}
          </div>
        </aside>
      </div>
    </section>
    <div class="panel panel-tool" id="toolPanel">
      <div class="panel-strip" id="strip">${opts.strip()}</div>
      <nav class="tabs" id="tabs">${opts.tabs()}</nav>
      <div class="list" id="list"></div>
    </div>
  `;
  applyI18n();
  if (opts.canIngest) $('#ingestBtn').addEventListener('click', () => opts.ingest());
  $('#reloadBtn').addEventListener('click', async () => {
    await opts.reload();
    showToast(t('toast.complete'), 'success');
  });
  // bind tabs
  $$('#tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('#tabs .tab').forEach(t => t.classList.remove('is-on'));
      tab.classList.add('is-on');
      opts.onTabChange(tab.dataset.tab);
    });
  });
  // initial render of list
  opts.renderList();
  // search
  const search = $('#toolSearch');
  if (search) {
    search.addEventListener('input', e => {
      opts.onSearch(e.target.value.trim());
    });
  }
}

function stripCell(k, v, accent=false) {
  return `<div class="strip-cell">
    <span class="cell-k">${escapeHtml(k)}</span>
    <span class="cell-v mono ${accent ? 'accent' : ''}">${v}</span>
  </div>`;
}

// =====================================================================
// RENDER — PULSE
// =====================================================================
function renderPulse() {
  const d = state.pulse.data;
  renderToolPage({
    kind: 'pulse',
    num: '01',
    title: TOOL_META.pulse.name,
    long: TOOL_META.pulse.long,
    canIngest: true,
    strip: () => {
      if (!d) return stripCell(t('panel.generated'), '—') + stripCell(t('panel.sources'), '—') + stripCell(t('panel.items'), '—') + stripCell(t('panel.after_dedup'), '—') + stripCell(t('panel.top_score'), '—', true);
      const lastTop = (d.top_items || [])[0];
      return [
        stripCell(t('panel.generated'), escapeHtml((d.generated_at || '').replace('T', ' ').slice(0, 16))),
        stripCell(t('panel.sources'), `${d.total_sources} <span class="cell-unit">live</span>`),
        stripCell(t('panel.items'), d.total_raw),
        stripCell(t('panel.after_dedup'), `${d.total_unique} <span class="cell-unit">kept</span>`),
        stripCell(t('panel.top_score'), lastTop ? lastTop.score.toFixed(2) : '—', true),
      ].join('');
    },
    tabs: () => `
      <button class="tab is-on" data-tab="all" type="button">${t('pulse.tab.all')} <span class="tab-n mono">${(d?.top_items||[]).length}</span></button>
      <button class="tab" data-tab="zh" type="button">${t('pulse.tab.zh')} <span class="tab-n mono">${(d?.chinese_items||[]).length}</span></button>
      <button class="tab" data-tab="en" type="button">${t('pulse.tab.en')} <span class="tab-n mono">${(d?.english_items||[]).length}</span></button>
      <div class="tabs-spacer"></div>
      <label class="search">
        <span class="search-ic">⌕</span>
        <input id="toolSearch" type="search" placeholder="${t('action.search')}…" />
        <kbd class="search-kbd">/</kbd>
      </label>
    `,
    onTabChange: (tab) => { state.pulse.tab = tab; renderPulseList(); },
    onSearch: (q) => { state.pulse.query = q; renderPulseList(); },
    ingest: () => triggerIngest('ai-daily', 'pulse', () => loadPulse().then(renderPulse)),
    reload: () => loadPulse().then(renderPulse),
    renderList: renderPulseList,
  });
}
function getPulseItems() {
  if (!state.pulse.data) return [];
  const { tab, query } = state.pulse;
  let items = tab === 'zh' ? state.pulse.data.chinese_items
            : tab === 'en' ? state.pulse.data.english_items
            : state.pulse.data.top_items;
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(it =>
      (it.title||'').toLowerCase().includes(q) ||
      (it.summary||'').toLowerCase().includes(q) ||
      (it.source||'').toLowerCase().includes(q)
    );
  }
  return items;
}
function renderPulseList() {
  const items = getPulseItems();
  const list = $('#list');
  if (!items || !items.length) {
    list.innerHTML = emptyStateHtml(t('pulse.empty.title'), t('pulse.empty.body'));
    return;
  }
  list.innerHTML = items.map((it, i) => {
    const isZh = (it.tags || []).includes('zh');
    const ago = timeAgo(it.published);
    const id = it.url_hash || it.url;
    const bk = state.bookmarks.news.has(id);
    return `
      <article class="news-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="news-score">
          <div class="news-score-val">${(it.score || 0).toFixed(2)}</div>
          <div class="news-score-bar" style="--w:${Math.round((it.score || 0) * 100)}%"></div>
        </div>
        <div class="news-body">
          <div class="news-meta">
            <span class="news-lang ${isZh ? 'zh' : 'en'}">${isZh ? '中' : 'EN'}</span>
            <span class="news-src">${escapeHtml(it.source || '')}</span>
            ${(it.tags || []).filter(x => x !== 'zh' && x !== 'en').slice(0, 3).map(x => `<span class="news-tag">${escapeHtml(x)}</span>`).join('')}
          </div>
          <h3 class="news-title">
            <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title || '')}</a>
          </h3>
          ${it.summary ? `<p class="news-summary">${escapeHtml(it.summary)}</p>` : ''}
        </div>
        <div class="news-side">
          <button class="bk-btn ${bk ? 'on' : ''}" data-id="${escapeHtml(id)}" data-kind="news" title="${t('action.bookmark')}">${bk ? '★' : '☆'}</button>
          <span class="news-ago ${ago.cls}">${ago.rel}</span>
          <span class="news-time" title="${ago.exact}">${ago.exact.slice(11, 16)}Z</span>
          ${it.author ? `<span class="news-author">${escapeHtml(it.author)}</span>` : ''}
        </div>
      </article>`;
  }).join('');
  bindBookmarkBtns(list);
}

// =====================================================================
// RENDER — VELOCITY
// =====================================================================
function renderVelocity() {
  const d = state.velocity.data;
  renderToolPage({
    kind: 'velocity',
    num: '02',
    title: TOOL_META.velocity.name,
    long: TOOL_META.velocity.long,
    canIngest: true,
    strip: () => {
      if (!d) return stripCell(t('panel.generated'), '—') + stripCell(t('panel.unique'), '—') + stripCell(t('panel.tracks'), '—') + stripCell(t('panel.window'), '—') + stripCell(t('panel.top_score'), '—', true);
      const top = (d.composite_top || [])[0];
      return [
        stripCell(t('panel.generated'), escapeHtml((d.generated_at||'').replace('T',' ').slice(0,16))),
        stripCell(t('panel.unique'), d.unique_repo_count),
        stripCell(t('panel.tracks'), 'A · B'),
        stripCell(t('panel.window'), '7–30d'),
        stripCell(t('panel.top_score'), top ? top.score.toFixed(2) : '—', true),
      ].join('');
    },
    tabs: () => {
      const c = (k) => ((d?.sections || {})[k] || {}).repos?.length || 0;
      return `
        <button class="tab is-on" data-tab="composite" type="button">${t('velocity.tab.composite')} <span class="tab-n mono">${(d?.composite_top||[]).length}</span></button>
        <button class="tab" data-tab="trending_daily" type="button">${t('velocity.tab.daily')} <span class="tab-n mono">${c('trending_daily')}</span></button>
        <button class="tab" data-tab="trending_weekly" type="button">${t('velocity.tab.weekly')} <span class="tab-n mono">${c('trending_weekly')}</span></button>
        <button class="tab" data-tab="trending_monthly" type="button">${t('velocity.tab.monthly')} <span class="tab-n mono">${c('trending_monthly')}</span></button>
        <button class="tab" data-tab="recent_7d_popular" type="button">${t('velocity.tab.recent')} <span class="tab-n mono">${c('recent_7d_popular')}</span></button>
        <button class="tab" data-tab="active_30d" type="button">${t('velocity.tab.active')} <span class="tab-n mono">${c('active_30d')}</span></button>
        <div class="tabs-spacer"></div>
        <label class="search">
          <span class="search-ic">⌕</span>
          <input id="toolSearch" type="search" placeholder="${t('action.search')}…" />
          <kbd class="search-kbd">/</kbd>
        </label>
      `;
    },
    onTabChange: (tab) => { state.velocity.tab = tab; renderVelocityList(); },
    onSearch: (q) => { state.velocity.query = q; renderVelocityList(); },
    ingest: () => triggerIngest('github', 'velocity', () => loadVelocity().then(renderVelocity)),
    reload: () => loadVelocity().then(renderVelocity),
    renderList: renderVelocityList,
  });
}
function getVelocityItems() {
  if (!state.velocity.data) return [];
  const { tab, query } = state.velocity;
  let items = tab === 'composite' ? state.velocity.data.composite_top
            : (state.velocity.data.sections?.[tab] || {}).repos || [];
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(r =>
      (r.full_name||'').toLowerCase().includes(q) ||
      (r.description||'').toLowerCase().includes(q) ||
      (r.language||'').toLowerCase().includes(q)
    );
  }
  return items;
}
function renderVelocityList() {
  const items = getVelocityItems();
  const list = $('#list');
  if (!items || !items.length) { list.innerHTML = emptyStateHtml(t('velocity.empty.title'), t('velocity.empty.body')); return; }
  const composite = state.velocity.tab === 'composite';
  list.innerHTML = items.map((r, i) => {
    const ps = r.today_stars || r.weekly_stars || r.monthly_stars || 0;
    const total = r.total_stars || r.stars || 0;
    const id = r.full_name;
    const bk = state.bookmarks.github.has(id);
    const spark = sparkline(r.star_history || []);
    return `
      <article class="repo-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="repo-rank ${i < 3 ? 'top' : ''}">${String(i+1).padStart(2,'0')}</div>
        <div class="repo-body">
          <div class="repo-meta">
            ${r.language ? `<span class="lang-chip"><span class="lang-dot" style="background:${langColor(r.language)};--lang-color:${langColor(r.language)}"></span>${escapeHtml(r.language)}</span>` : ''}
            <span class="repo-period">${escapeHtml(r.period || 'window')}</span>
            ${r.source ? `<span class="repo-source ${escapeHtml(r.source)}">via ${escapeHtml(r.source)}</span>` : ''}
            ${spark ? `<span class="repo-spark">${spark}</span>` : ''}
          </div>
          <h3 class="repo-title">
            <a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">
              <span class="repo-owner">${escapeHtml((r.full_name||'').split('/')[0] || '')}/</span><span class="repo-name">${escapeHtml((r.full_name||'').split('/')[1] || r.full_name || '')}</span>
            </a>
          </h3>
          ${r.description ? `<p class="repo-desc">${escapeHtml(r.description)}</p>` : ''}
        </div>
        <div class="repo-side">
          <button class="bk-btn ${bk ? 'on' : ''}" data-id="${escapeHtml(id)}" data-kind="github" title="${t('action.bookmark')}">${bk ? '★' : '☆'}</button>
          <div class="repo-stars">${fmtNumber(total)}<span class="repo-stars-unit">★</span></div>
          ${ps ? `<div class="repo-delta">+${fmtNumber(ps)} · ${escapeHtml(r.period || '')}</div>` : '<div class="repo-delta zero">no delta</div>'}
          ${composite ? `<div class="repo-composite">composite · <span class="v">${(r.score || 0).toFixed(2)}</span></div>` : ''}
        </div>
      </article>`;
  }).join('');
  bindBookmarkBtns(list);
}

// =====================================================================
// RENDER — LAB
// =====================================================================
function renderLab() {
  const d = state.lab.data;
  renderToolPage({
    kind: 'lab',
    num: '03',
    title: TOOL_META.lab.name,
    long: TOOL_META.lab.long,
    canIngest: true,
    strip: () => {
      if (!d) return stripCell(t('panel.generated'), '—') + stripCell(t('panel.papers'), '—') + stripCell(t('panel.sources'), '—') + stripCell(t('panel.window'), '—') + stripCell(t('panel.latest'), '—', true);
      const latest = d.papers?.[0];
      return [
        stripCell(t('panel.generated'), escapeHtml((d.generated_at||'').replace('T',' ').slice(0,16))),
        stripCell(t('panel.papers'), d.total),
        stripCell(t('panel.sources'), 'cs.AI · cs.CL · cs.LG'),
        stripCell(t('panel.window'), t('panel.last_7d')),
        stripCell(t('panel.latest'), latest ? latest.primary_category || 'cs' : '—', true),
      ].join('');
    },
    tabs: () => `
      <button class="tab is-on" data-tab="all" type="button">${t('lab.tab.all')} <span class="tab-n mono">${(d?.papers||[]).length}</span></button>
      <div class="tabs-spacer"></div>
      <label class="search">
        <span class="search-ic">⌕</span>
        <input id="toolSearch" type="search" placeholder="${t('action.search')}…" />
        <kbd class="search-kbd">/</kbd>
      </label>
    `,
    onTabChange: (tab) => { state.lab.tab = tab; renderLabList(); },
    onSearch: (q) => { state.lab.query = q; renderLabList(); },
    ingest: () => triggerIngest('arxiv', 'lab', () => loadLab().then(renderLab)),
    reload: () => loadLab().then(renderLab),
    renderList: renderLabList,
  });
}
function renderLabList() {
  const d = state.lab.data;
  const q = state.lab.query?.toLowerCase() || '';
  let items = d?.papers || [];
  if (q) items = items.filter(p =>
    (p.title||'').toLowerCase().includes(q) ||
    (p.authors||[]).join(' ').toLowerCase().includes(q) ||
    (p.summary||'').toLowerCase().includes(q)
  );
  const list = $('#list');
  if (!items.length) { list.innerHTML = emptyStateHtml(t('lab.empty.title'), t('lab.empty.body')); return; }
  list.innerHTML = items.slice(0, 30).map((p, i) => {
    const ago = timeAgo(p.published);
    const id = p.id || p.url;
    const bk = state.bookmarks.papers.has(id);
    return `
      <article class="news-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="news-score">
          <div class="news-score-val" style="color:var(--signal)">${escapeHtml((p.primary_category || 'cs').slice(0,4))}</div>
          <div class="news-score-bar" style="--w:${Math.min(100, (p.heat||0.5)*100)}%; background:linear-gradient(90deg, var(--signal) 0%, var(--accent) 100%)"></div>
        </div>
        <div class="news-body">
          <div class="news-meta">
            <span class="news-lang en">arXiv</span>
            <span class="news-src">${escapeHtml(p.primary_category || '')}</span>
            <span class="news-tag">${(p.categories||[]).slice(0,3).map(escapeHtml).join(' · ')}</span>
          </div>
          <h3 class="news-title">
            <a href="${escapeHtml(p.url || p.id)}" target="_blank" rel="noopener">${escapeHtml(p.title || '')}</a>
          </h3>
          <p class="news-summary">${escapeHtml((p.summary || '').slice(0, 240))}${(p.summary||'').length > 240 ? '…' : ''}</p>
        </div>
        <div class="news-side">
          <button class="bk-btn ${bk ? 'on' : ''}" data-id="${escapeHtml(id)}" data-kind="paper" title="${t('action.bookmark')}">${bk ? '★' : '☆'}</button>
          <span class="news-ago ${ago.cls}">${ago.rel}</span>
          <span class="news-time">${ago.exact.slice(11, 16)}Z</span>
          <span class="news-author">${escapeHtml((p.authors||[]).slice(0,2).join(', '))}${(p.authors||[]).length > 2 ? ' +'+(p.authors.length-2) : ''}</span>
        </div>
      </article>`;
  }).join('');
  bindBookmarkBtns(list);
}

// =====================================================================
// RENDER — WEIGHTS
// =====================================================================
function renderWeights() {
  const d = state.weights.data;
  renderToolPage({
    kind: 'weights',
    num: '04',
    title: TOOL_META.weights.name,
    long: TOOL_META.weights.long,
    canIngest: true,
    strip: () => {
      if (!d) return stripCell(t('panel.generated'), '—') + stripCell(t('panel.models'), '—') + stripCell(t('panel.datasets'), '—') + stripCell(t('panel.papers'), '—') + stripCell(t('panel.latest'), '—', true);
      return [
        stripCell(t('panel.generated'), escapeHtml((d.generated_at||'').replace('T',' ').slice(0,16))),
        stripCell(t('panel.models'), (d.models||[]).length),
        stripCell(t('panel.datasets'), (d.datasets||[]).length),
        stripCell(t('panel.papers'), (d.papers||[]).length),
        stripCell(t('panel.sources'), 'huggingface.co', true),
      ].join('');
    },
    tabs: () => `
      <button class="tab is-on" data-tab="models" type="button">${t('weights.tab.models')} <span class="tab-n mono">${(d?.models||[]).length}</span></button>
      <button class="tab" data-tab="datasets" type="button">${t('weights.tab.datasets')} <span class="tab-n mono">${(d?.datasets||[]).length}</span></button>
      <button class="tab" data-tab="papers" type="button">${t('weights.tab.papers')} <span class="tab-n mono">${(d?.papers||[]).length}</span></button>
      <div class="tabs-spacer"></div>
      <label class="search">
        <span class="search-ic">⌕</span>
        <input id="toolSearch" type="search" placeholder="${t('action.search')}…" />
        <kbd class="search-kbd">/</kbd>
      </label>
    `,
    onTabChange: (tab) => { state.weights.tab = tab; renderWeightsList(); },
    onSearch: (q) => { state.weights.query = q; renderWeightsList(); },
    ingest: () => triggerIngest('hf', 'weights', () => loadWeights().then(renderWeights)),
    reload: () => loadWeights().then(renderWeights),
    renderList: renderWeightsList,
  });
}
function renderWeightsList() {
  const d = state.weights.data;
  const tab = state.weights.tab;
  const q = state.weights.query?.toLowerCase() || '';
  let items = d?.[tab] || [];
  if (q) items = items.filter(m => (m.id||'').toLowerCase().includes(q) || (m.description||'').toLowerCase().includes(q));
  const list = $('#list');
  if (!items.length) { list.innerHTML = emptyStateHtml(t('weights.empty.title'), t('weights.empty.body')); return; }
  list.innerHTML = items.slice(0, 30).map((m, i) => {
    const id = m.id || m.name;
    return `
      <article class="repo-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="repo-rank ${i < 3 ? 'top' : ''}">${String(i+1).padStart(2,'0')}</div>
        <div class="repo-body">
          <div class="repo-meta">
            <span class="lang-chip"><span class="lang-dot" style="background:${langColor(m.language || m.library || '')}"></span>${escapeHtml(m.language || m.library || m.task || 'model')}</span>
            <span class="repo-period">${escapeHtml(m.task || m.task_categories?.[0] || 'trending')}</span>
            <span class="repo-source">via huggingface</span>
          </div>
          <h3 class="repo-title">
            <a href="${escapeHtml(m.url || ('https://huggingface.co/'+id))}" target="_blank" rel="noopener">
              <span class="repo-owner">${escapeHtml((id||'').split('/')[0] || '')}/</span><span class="repo-name">${escapeHtml((id||'').split('/')[1] || id || '')}</span>
            </a>
          </h3>
          ${m.description ? `<p class="repo-desc">${escapeHtml((m.description||'').slice(0, 200))}</p>` : ''}
        </div>
        <div class="repo-side">
          <div class="repo-stars">${fmtNumber(m.downloads || 0)}<span class="repo-stars-unit">↓</span></div>
          ${m.likes != null ? `<div class="repo-delta">+${fmtNumber(m.likes)} ${t('panel.likes')}</div>` : ''}
          ${m.trending_score != null ? `<div class="repo-composite">${t('panel.trending')} · <span class="v">${(m.trending_score||0).toFixed(2)}</span></div>` : ''}
        </div>
      </article>`;
  }).join('');
}

// =====================================================================
// RENDER — HISTORY
// =====================================================================
function renderHistory() {
  const v = $('#view');
  const kinds = ['all', ...state.history.kinds];
  const items = state.history.snapshots;
  const filtered = state.history.filter === 'all' ? items : items.filter(s => s.kind === state.history.filter);

  v.innerHTML = `
    <section class="masthead masthead-tool">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span class="tool-num" style="color:var(--accent)">06</span>
            <span data-i18n="history.title">Snapshots</span>
          </h1>
          <p class="mast-sub" data-i18n="history.deck">Every ingest is archived here. Browse by date or by tool.</p>
        </div>
        <aside class="mast-right">
          <div class="hist-filter">
            <label data-i18n="history.filter.kind">Kind</label>
            <div class="hist-filter-tabs" id="kindFilter">
              ${kinds.map(k => `<button class="tab is-on" data-kind="${k}" type="button">${escapeHtml(k)}</button>`).join('')}
            </div>
          </div>
        </aside>
      </div>
    </section>
    <div class="panel panel-history">
      <div class="list list-history" id="list">
        ${filtered.length ? filtered.map((s, i) => `
          <article class="hist-row" data-kind="${escapeHtml(s.kind)}" data-ts="${escapeHtml(s.ts)}" style="animation-delay:${Math.min(i, 12)*15}ms">
            <div class="hist-kind hist-kind-${escapeHtml(s.kind)}">${escapeHtml(s.kind)}</div>
            <div class="hist-when">
              <div class="hist-iso">${escapeHtml(s.iso?.slice(0,16).replace('T',' ') || '')}</div>
              <div class="hist-rel">${timeAgo(s.iso).rel} ago</div>
            </div>
            <div class="hist-stats">
              <span class="hist-stat"><span class="cell-k">${t('history.col.items')}</span> <span class="mono">${s.items ?? 0}</span></span>
              <span class="hist-stat"><span class="cell-k">${t('history.col.size')}</span> <span class="mono">${fmtSize(s.size || 0)}</span></span>
            </div>
            <div class="hist-actions">
              <button class="btn btn-ghost btn-sm hist-open" type="button" data-i18n="history.open">Open</button>
            </div>
          </article>
        `).join('') : emptyStateHtml(t('history.empty.title'), t('history.empty.body'))}
      </div>
    </div>
  `;
  applyI18n();
  // bind filter
  $$('#kindFilter .tab').forEach((tab, i) => {
    if (i > 0) tab.classList.remove('is-on');
    tab.addEventListener('click', () => {
      $$('#kindFilter .tab').forEach(x => x.classList.remove('is-on'));
      tab.classList.add('is-on');
      state.history.filter = tab.dataset.kind;
      renderHistory();
    });
  });
  // bind open
  $$('.hist-open').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.hist-row');
      const kind = row.dataset.kind, ts = row.dataset.ts;
      const r = await api(`/api/history/${kind}/${ts}`);
      if (r.ok) {
        openSnapshotViewer(kind, ts, r.json.data);
      } else {
        showToast('open failed', 'error');
      }
    });
  });
}
function fmtSize(b) {
  if (!b) return '—';
  if (b < 1024) return b + 'B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + 'KB';
  return (b/1024/1024).toFixed(2) + 'MB';
}
function openSnapshotViewer(kind, ts, payload) {
  const meta = payload._meta || {};
  const items = payload.top_items || payload.papers || payload.models || payload.composite_top || [];
  const viewer = document.createElement('div');
  viewer.className = 'modal-back';
  viewer.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div>
          <div class="kicker">${escapeHtml(kind)} · snapshot</div>
          <h2 class="modal-title">${escapeHtml(ts)}</h2>
        </div>
        <button class="modal-close" type="button">✕</button>
      </header>
      <div class="modal-body">
        <div class="modal-meta">
          <span>${escapeHtml(meta.iso || '')}</span>
          <span>${items.length} items</span>
          <span>${fmtSize(meta.size || 0)}</span>
        </div>
        <div class="modal-list">
          ${items.slice(0, 50).map(it => `
            <a class="modal-item" href="${escapeHtml(it.url || it.html_url || '#')}" target="_blank" rel="noopener">
              <div class="modal-item-title">${escapeHtml(it.title || it.full_name || '')}</div>
              <div class="modal-item-sub">${escapeHtml(it.source || it.primary_category || it.language || '')}</div>
            </a>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(viewer);
  viewer.addEventListener('click', e => { if (e.target === viewer) viewer.remove(); });
  viewer.querySelector('.modal-close').addEventListener('click', () => viewer.remove());
}

// =====================================================================
// RENDER — DIGEST
// =====================================================================
function renderDigest() {
  const v = $('#view');
  v.innerHTML = `
    <section class="masthead masthead-tool">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span class="tool-num" style="color:var(--accent)">05</span>
            <span data-i18n="tool.digest.name">Daily Digest</span>
          </h1>
          <p class="mast-sub" data-i18n="tool.digest.long">A single, sharable Markdown report…</p>
        </div>
        <aside class="mast-right">
          <div class="tool-ctas">
            <button class="btn btn-ghost" id="digestDownload" type="button" data-i18n="digest.download">Download</button>
            <button class="btn btn-primary" id="digestGen" type="button">
              <span class="btn-label" data-i18n="digest.generate">Generate today's digest</span>
              <span class="btn-arrow">↗</span>
            </button>
          </div>
        </aside>
      </div>
    </section>
    <div class="panel panel-digest">
      <div class="digest-meta" id="digestMeta">
        ${state.digest.date ? `<span class="kicker">${state.digest.date}</span>` : `<span class="kicker">${t('digest.empty')}</span>`}
      </div>
      <pre class="digest-pre" id="digestPre">${escapeHtml(state.digest.content || '—')}</pre>
    </div>
  `;
  applyI18n();
  $('#digestGen').addEventListener('click', async () => {
    setStatus('busy', t('status.busy'));
    setProgress(true, t('status.busy'));
    showToast(t('toast.started'));
    await api('/api/digest/generate', { method: 'POST' });
    setTimeout(async () => {
      await loadDigest();
      renderDigest();
      setStatus('ready', t('status.ready'));
      setProgress(false);
      showToast(t('toast.complete'), 'success');
    }, 5000);
  });
  $('#digestDownload').addEventListener('click', () => {
    if (!state.digest.content) { showToast(t('digest.empty'), 'error'); return; }
    const blob = new Blob([state.digest.content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `insight-digest-${state.digest.date || 'today'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// =====================================================================
// RENDER — SETTINGS
// =====================================================================
function renderSettings() {
  const v = $('#view');
  v.innerHTML = `
    <section class="masthead masthead-tool">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span class="tool-num" style="color:var(--accent)">⚙</span>
            <span data-i18n="settings.title">Settings</span>
          </h1>
          <p class="mast-sub" data-i18n="settings.deck">Tune the console…</p>
        </div>
      </div>
    </section>
    <div class="panel panel-settings">
      <div class="settings-grid">
        <div class="settings-block">
          <div class="settings-h" data-i18n="settings.theme">Theme</div>
          <div class="settings-row">
            <button class="seg ${state.theme==='dark' ? 'is-on' : ''}" data-theme="dark" type="button" data-i18n="settings.theme.dark">Operator (dark)</button>
            <button class="seg ${state.theme==='light' ? 'is-on' : ''}" data-theme="light" type="button" data-i18n="settings.theme.light">Editor (light)</button>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-h" data-i18n="settings.accent">Accent</div>
          <div class="settings-row">
            ${ACCENT_CYCLE.map(a => `<button class="seg seg-accent ${state.accent===a ? 'is-on' : ''}" data-accent="${a}" type="button">
              <span class="seg-dot" style="background:${ACCENT_PALETTES[a].color}"></span> ${t('settings.accent.'+a, a)}
            </button>`).join('')}
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-h" data-i18n="settings.lang">Language</div>
          <div class="settings-row">
            <button class="seg ${state.lang==='en' ? 'is-on' : ''}" data-lang="en" type="button" data-i18n="settings.lang.en">English</button>
            <button class="seg ${state.lang==='zh-CN' ? 'is-on' : ''}" data-lang="zh-CN" type="button" data-i18n="settings.lang.zh">中文</button>
          </div>
        </div>
        <div class="settings-block settings-about">
          <div class="settings-h" data-i18n="settings.about">About</div>
          <p class="settings-body" data-i18n="settings.about.body">A reading room for the curious. No algorithms decide what you see first; only transparent scores. Built in 2026.06.</p>
          <div class="settings-credits">
            ${state.bookmarks.news.size + state.bookmarks.github.size + state.bookmarks.papers.size} bookmarks ·
            <button class="link-btn" id="resetBookmarks" type="button">Reset all bookmarks</button>
          </div>
        </div>
      </div>
    </div>
  `;
  applyI18n();
  $$('.seg[data-theme]').forEach(b => b.addEventListener('click', () => {
    state.theme = b.dataset.theme;
    applyTheme(); applyAccent(); savePrefs();
    renderSettings();
  }));
  $$('.seg[data-accent]').forEach(b => b.addEventListener('click', () => {
    state.accent = b.dataset.accent;
    applyAccent(); savePrefs();
    renderSettings();
  }));
  $$('.seg[data-lang]').forEach(b => b.addEventListener('click', async () => {
    state.lang = b.dataset.lang;
    await loadI18n();
    savePrefs();
    renderSettings();
  }));
  $('#resetBookmarks')?.addEventListener('click', () => {
    state.bookmarks = { news: new Set(), github: new Set(), papers: new Set() };
    persistBookmarks();
    renderSettings();
    showToast('Bookmarks reset', 'success');
  });
}

// =====================================================================
// BOOKMARKS / TRIGGERS / SPARKLINE
// =====================================================================
function bindBookmarkBtns(root) {
  $$('.bk-btn', root).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const kind = btn.dataset.kind;
      const id = btn.dataset.id;
      const map = kind === 'news' ? state.bookmarks.news
        : kind === 'github' ? state.bookmarks.github
        : state.bookmarks.papers;
      const added = !map.has(id);
      if (added) map.add(id); else map.delete(id);
      persistBookmarks();
      btn.classList.toggle('on', added);
      btn.textContent = added ? '★' : '☆';
      showToast(added ? t('toast.bookmark_added') : t('toast.bookmark_removed'));
    });
  });
}
function triggerIngest(endpoint, kind, after) {
  return async () => {
    setStatus('busy', t('status.busy'));
    setProgress(true, t('status.busy'));
    showToast(t('toast.started'));
    await api(`/api/${endpoint}`, { method: 'POST' });
    setTimeout(async () => {
      await after();
      setStatus('ready', t('status.ready'));
      setProgress(false);
      showToast(t('toast.complete'), 'success');
    }, 5000);
  };
}
function sparkline(points, w=80, h=22) {
  if (!points || !points.length) return '';
  const stroke = points.length >= 2 && points[points.length-1] >= points[0]
    ? 'var(--signal)' : (points.length >= 2 ? 'var(--bad)' : 'var(--txt-3)');
  if (points.length === 1) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><circle cx="${w/2}" cy="${h/2}" r="3" fill="${stroke}"/></svg>`;
  }
  const min = Math.min(...points), max = Math.max(...points);
  const range = (max - min) || 1;
  const dx = w / (points.length - 1);
  const pts = points.map((v, i) => `${(i*dx).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="${stroke}" fill-opacity="0.12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
function emptyStateHtml(title, body) {
  return `<div class="empty" data-state="rest">
    <div class="empty-mark">∅</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
  </div>`;
}

// =====================================================================
// EXPORT BOOKMARKS
// =====================================================================
function exportBookmarks() {
  const all = [];
  for (const [kind, set] of [['news', state.bookmarks.news], ['github', state.bookmarks.github], ['papers', state.bookmarks.papers]]) {
    for (const id of set) all.push({ kind, id, ts: new Date().toISOString() });
  }
  if (!all.length) { showToast(t('toast.no_bookmarks'), 'error'); return; }
  const enrich = (kind, id) => {
    if (kind === 'news') {
      const it = (state.pulse.data?.top_items || []).find(x => (x.url_hash || x.url) === id);
      return it ? { title: it.title, url: it.url, source: it.source } : {};
    }
    if (kind === 'github') {
      const r = (state.velocity.data?.composite_top || []).find(x => x.full_name === id)
        || Object.values(state.velocity.data?.sections || {}).flatMap(s => s.repos).find(x => x.full_name === id);
      return r ? { title: r.full_name, url: r.html_url, source: 'GitHub' } : {};
    }
    if (kind === 'paper') {
      const p = (state.lab.data?.papers || []).find(x => (x.id || x.url) === id);
      return p ? { title: p.title, url: p.url || p.id, source: 'arXiv' } : {};
    }
    return {};
  };
  const lines = ['# Insight Bookmarks', `*Exported ${new Date().toISOString()}*`, ''];
  for (const b of all) {
    const { title, url, source } = enrich(b.kind, b.id);
    lines.push(`- [${title || b.id}](${url || '#'}) — *${source || b.kind}*`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `insight-bookmarks-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast(t('toast.exported'), 'success');
}

// =====================================================================
// BOOT
// =====================================================================
async function init() {
  // theme + accent
  applyTheme();
  applyAccent();
  // i18n
  await loadI18n();
  // top-level
  startClock();
  setStatus('idle', t('status.connecting'));
  // global buttons
  $('#btnExportBookmarks').addEventListener('click', exportBookmarks);
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#accentBtn').addEventListener('click', cycleAccent);
  $$('.lang-btn').forEach(b => b.addEventListener('click', async () => {
    state.lang = b.dataset.lang;
    savePrefs();
    await loadI18n();
    route();
  }));
  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      const inp = $('#toolSearch') || $('input[type=search]');
      if (inp) inp.focus();
    }
  });
  // default hash
  if (!location.hash) location.hash = '#/';
  setStatus('ready', t('status.ready'));
  await route();
}
document.addEventListener('DOMContentLoaded', init);
