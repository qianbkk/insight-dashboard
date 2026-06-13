/* ============================================================
   INSIGHT // Operator's Console
   ============================================================ */
'use strict';

// -----------------------------------------------------------------
// Utils
// -----------------------------------------------------------------
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const escapeHtml = s => s == null ? '' : String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

const timeAgo = iso => {
  if (!iso) return { rel: '—', cls: 'stale', exact: '' };
  const d = new Date(iso); if (isNaN(d.getTime())) return { rel: '—', cls: 'stale', exact: '' };
  const diff = (Date.now() - d.getTime()) / 1000;
  let rel, cls = 'stale';
  if (diff < 60)            { rel = 'now'; cls = 'fresh'; }
  else if (diff < 3600)     { rel = Math.floor(diff/60) + 'm'; cls = 'fresh'; }
  else if (diff < 86400)    { rel = Math.floor(diff/3600) + 'h'; cls = 'fresh'; }
  else if (diff < 86400*7)  { rel = Math.floor(diff/86400) + 'd'; }
  else if (diff < 86400*30) { rel = Math.floor(diff/(86400*7)) + 'w'; }
  else                       rel = Math.floor(diff/(86400*30)) + 'mo';
  return { rel, cls, exact: d.toISOString().replace('T',' ').slice(0,16) + 'Z' };
};
const fmtNumber = n => {
  if (n == null) return '—';
  n = Number(n);
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
  return String(n);
};
const fmtSize = b => {
  if (!b) return '—';
  if (b < 1024) return b + 'B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + 'KB';
  return (b/1024/1024).toFixed(2) + 'MB';
};
const LANG_COLORS = {
  Python:'#3572A5', JavaScript:'#f1e05a', TypeScript:'#3178c6', Go:'#00ADD8',
  Rust:'#dea584', Java:'#b07219', 'C++':'#f34b7d', 'C#':'#178600', C:'#555555',
  Shell:'#89e051', Swift:'#F05138', Kotlin:'#A97BFF', Ruby:'#701516',
  PHP:'#4F5D95', HTML:'#e34c26', CSS:'#563d7c', Lua:'#000080', Dart:'#00B4AB',
  Jupyter:'#DA5B0B', R:'#198CE7',
};
const langColor = n => LANG_COLORS[n] || '#8b94a7';

const stripCell = (k, v, accent = false) =>
  `<div class="strip-cell"><span class="cell-k">${escapeHtml(k)}</span><span class="cell-v mono ${accent ? 'accent' : ''}">${v}</span></div>`;

const emptyStateHtml = (title, body) => `
  <div class="empty" data-state="rest">
    <div class="empty-mark">∅</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
  </div>`;

function sparkline(points, w = 80, h = 22) {
  if (!points || !points.length) return '';
  const stroke = points.length >= 2 && points[points.length - 1] >= points[0]
    ? 'var(--signal)' : (points.length >= 2 ? 'var(--bad)' : 'var(--txt-3)');
  if (points.length === 1) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><circle cx="${w/2}" cy="${h/2}" r="3" fill="${stroke}"/></svg>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = (max - min) || 1;
  const dx = w / (points.length - 1);
  const pts = points.map((v, i) =>
    `${(i * dx).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`
  );
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polygon points="0,${h} ${pts.join(' ')} ${w},${h}" fill="${stroke}" fill-opacity="0.12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// -----------------------------------------------------------------
// State
// -----------------------------------------------------------------
const state = {
  pulse:    { data: null, tab: 'all',       query: '', viewingSnapshot: null },
  velocity: { data: null, tab: 'composite',query: '', viewingSnapshot: null },
  lab:      { data: null, tab: 'papers',   query: '', viewingSnapshot: null },
  weights:  { data: null, tab: 'models',   query: '', viewingSnapshot: null },
  digest:   { content: '', date: '' },
  history:  { snapshots: [] },  // cache of last-loaded snapshot list per kind
  route: '#/',
  i18n: { en: {}, 'zh-CN': {} },
  lang: 'zh-CN',
  theme: 'dark',
  accent: 'amber',
  bookmarks: { news: new Set(), github: new Set(), papers: new Set() },
};

const PREF_KEY = 'insight_prefs_v2';
const BK_KEY = 'insight_bookmarks_v1';

const ACCENT_PALETTES = {
  amber:  { color: '#f5a524', color2: '#ffc857' },
  signal: { color: '#4ade80', color2: '#22d3ee' },
  violet: { color: '#b794f6', color2: '#8b5cf6' },
  coral:  { color: '#ff7a59', color2: '#fb7185' },
};
const ACCENT_CYCLE = ['amber', 'signal', 'violet', 'coral'];

const TOOL_META = {
  pulse:    { name: 'AI Pulse',     desc: 'Multi-source RSS digest',      long: 'Aggregates 15 RSS feeds. Items are ranked by AI-relevance × recency × source-authority. Stories that surface in 2+ sources are clustered and flagged.' },
  velocity: { name: 'Code Velocity',desc: 'GitHub trending + REST',      long: 'Two-track. Scrapes github.com/trending for the official daily/weekly/monthly cuts. Cross-checks with the REST search index for recent and active repos.' },
  lab:      { name: 'From the Lab', desc: 'arXiv cs.AI / cs.CL / cs.LG', long: 'Latest submissions from arXiv. The first place new ideas appear — usually 2–6 weeks before they hit the press.' },
  weights:  { name: 'Open Weights', desc: 'HuggingFace trending',         long: 'Trending models, datasets, and daily papers on HuggingFace. The live signal for what the open-source community is shipping right now.' },
  digest:   { name: 'Daily Digest', desc: 'Markdown briefing',            long: 'A single, sharable Markdown report that combines the day\'s AI Pulse, Code Velocity, lab papers, and trending models.' },
};

// -----------------------------------------------------------------
// Persistence
// -----------------------------------------------------------------
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ lang: state.lang, theme: state.theme, accent: state.accent })); } catch {} };
const loadBookmarks = () => {
  try {
    const o = JSON.parse(localStorage.getItem(BK_KEY) || '{}');
    return { news: new Set(o.news || []), github: new Set(o.github || []), papers: new Set(o.papers || []) };
  } catch { return { news: new Set(), github: new Set(), papers: new Set() }; }
};
const persistBookmarks = () => {
  try {
    localStorage.setItem(BK_KEY, JSON.stringify({
      news:   Array.from(state.bookmarks.news),
      github: Array.from(state.bookmarks.github),
      papers: Array.from(state.bookmarks.papers),
    }));
  } catch {}
};

// -----------------------------------------------------------------
// I18n
// -----------------------------------------------------------------
const t = (key, fallback) => {
  const dict = state.i18n[state.lang] || state.i18n['en'] || {};
  return dict[key] || fallback || key;
};
async function loadI18n() {
  for (const lang of [state.lang, state.lang === 'zh-CN' ? 'en' : 'zh-CN']) {
    if (Object.keys(state.i18n[lang] || {}).length) continue;
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
    const v = t(el.dataset.i18n);
    if (v && v !== el.dataset.i18n) el.textContent = v;
  });
  document.documentElement.lang = state.lang;
  $$('.lang-btn').forEach(b => b.classList.toggle('is-on', b.dataset.lang === state.lang));
}

// -----------------------------------------------------------------
// Theme / Accent
// -----------------------------------------------------------------
function applyTheme() { document.documentElement.dataset.theme = state.theme; }
function applyAccent() {
  const a = ACCENT_PALETTES[state.accent] || ACCENT_PALETTES.amber;
  const r = document.documentElement;
  r.dataset.accent = state.accent;
  r.style.setProperty('--accent', a.color);
  r.style.setProperty('--accent-2', a.color2);
  r.style.setProperty('--accent-soft', hexA(a.color, 0.12));
  r.style.setProperty('--accent-line', hexA(a.color, 0.32));
  // gh accent (only overrides when accent is amber; otherwise inherit)
  if (state.accent === 'amber') {
    r.style.setProperty('--gold', '#f6c453');
    r.style.setProperty('--gold-soft', hexA('#f6c453', 0.12));
    r.style.setProperty('--gold-line', hexA('#f6c453', 0.32));
  } else {
    r.style.setProperty('--gold', a.color);
    r.style.setProperty('--gold-soft', hexA(a.color, 0.12));
    r.style.setProperty('--gold-line', hexA(a.color, 0.32));
  }
  const dot = $('.accent-dot');
  if (dot) dot.style.background = a.color;
}
function hexA(hex, alpha) {
  const h = hex.replace('#','');
  return `rgba(${parseInt(h.substring(0,2),16)}, ${parseInt(h.substring(2,4),16)}, ${parseInt(h.substring(4,6),16)}, ${alpha})`;
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  savePrefs();
  if (location.hash.startsWith('#/settings')) renderSettings();
}
function cycleAccent() {
  const i = ACCENT_CYCLE.indexOf(state.accent);
  state.accent = ACCENT_CYCLE[(i + 1) % ACCENT_CYCLE.length];
  applyAccent();
  savePrefs();
}

// -----------------------------------------------------------------
// API helpers
// -----------------------------------------------------------------
async function api(path, opts = {}) {
  try {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok && !j.ok) j = { ok: false, error: j.message || r.statusText };
    return j.ok ? { ok: true, data: j.data, state: j.state } : { ok: false, error: j.error || 'request failed' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
function showToast(msg, type = '') {
  const el = $('#toast');
  $('.toast-msg', el).textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = 'toast ' + type; }, 2600);
}
function setStatus(s, label) {
  $('#status').dataset.state = s;
  $('#statusLabel').textContent = label;
}
function setProgress(visible, label) {
  const el = $('#progress');
  el.hidden = !visible;
  if (label) $('#progressLabel').textContent = label;
}

// -----------------------------------------------------------------
// Clock
// -----------------------------------------------------------------
function startClock() {
  const tick = () => {
    const d = new Date();
    $('.clock-hm').textContent =
      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    $('.clock-s').textContent = String(d.getSeconds()).padStart(2,'0');
  };
  tick();
  setInterval(tick, 1000);
}

// Map tool kind → backend kind id used in snapshot folders
const KIND_MAP = {
  pulse:    'ai_daily',
  velocity: 'github',
  lab:      'arxiv',
  weights:  'hf',
  digest:   'digest',
};
// Reverse for the display when reading from snapshot
const KIND_DISPLAY = {
  ai_daily: 'pulse',
  github:   'velocity',
  arxiv:    'lab',
  hf:       'weights',
  digest:   'digest',
};

async function loadPulse() {
  if (state.pulse.viewingSnapshot) return true;
  const r = await api('/api/ai-daily/data');
  if (r.ok) { state.pulse.data = r.data; return true; }
  return false;
}
async function loadVelocity() {
  if (state.velocity.viewingSnapshot) return true;
  const r = await api('/api/github/data');
  if (r.ok) { state.velocity.data = r.data; return true; }
  return false;
}
async function loadLab() {
  if (state.lab.viewingSnapshot) return true;
  const r = await api('/api/arxiv/data');
  if (r.ok) { state.lab.data = r.data; return true; }
  return false;
}
async function loadWeights() {
  if (state.weights.viewingSnapshot) return true;
  const r = await api('/api/hf/data');
  if (r.ok) { state.weights.data = r.data; return true; }
  return false;
}
async function loadHistoryForKind(kind) {
  const id = KIND_MAP[kind] || kind;
  const r = await api(`/api/history?kind=${id}`);
  if (r.ok) {
    const data = r.data || {};
    state.history.snapshots = data.snapshots || [];
    state.history.kinds = data.kinds || [];
    return state.history.snapshots;
  }
  return [];
}
async function loadDigest() {
  const r = await api('/api/digest/latest');
  if (r.ok) { state.digest.content = r.data.content; state.digest.date = r.data.date; return true; }
  return false;
}

// -----------------------------------------------------------------
// Router
// -----------------------------------------------------------------
const PAGES = {
  '#/':         { kind: 'home',     render: renderHome,     loader: () => Promise.all([loadPulse(), loadVelocity(), loadLab(), loadWeights()]) },
  '#/pulse':    { kind: 'pulse',    render: renderPulse,    loader: loadPulse },
  '#/velocity': { kind: 'velocity', render: renderVelocity, loader: loadVelocity },
  '#/lab':      { kind: 'lab',      render: renderLab,      loader: loadLab },
  '#/weights':  { kind: 'weights',  render: renderWeights,  loader: loadWeights },
  '#/digest':   { kind: 'digest',   render: renderDigest,   loader: loadDigest },
  '#/settings': { kind: 'settings', render: renderSettings, loader: async () => {} },
};

async function route() {
  const hash = location.hash || '#/';
  const page = PAGES[hash] || PAGES['#/'];
  state.route = hash;
  // update topnav active
  $$('#topnav .topnav-item').forEach(a => a.classList.toggle('active', a.dataset.route === hash));
  setStatus('busy', t('status.busy', 'Working'));
  setProgress(true, t('status.busy', 'Working'));
  try { await page.loader(); } catch (e) { /* swallow */ }
  setProgress(false);
  setStatus('ready', t('status.ready', 'Ready'));
  page.render();
  applyI18n();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', route);

// -----------------------------------------------------------------
// RENDER — HOME
// -----------------------------------------------------------------
function renderHome() {
  const v = $('#view');
  const totalSources = state.pulse.data?.total_sources || 0;
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
      ${toolCardPlaceholder('arxiv-news', '06', 'AI x arXiv cross-cut')}
      ${toolCardPlaceholder('hn', '07', 'Hacker News deep cuts')}
      ${toolCardPlaceholder('podcast', '08', 'Daily podcast (TTS)')}
    </section>
  `;
  $('#homeRunAll').addEventListener('click', async () => {
    setStatus('busy', t('status.busy'));
    setProgress(true, t('status.busy'));
    await Promise.all([
      api('/api/ai-daily', { method: 'POST' }),
      api('/api/github',   { method: 'POST' }),
      api('/api/arxiv',    { method: 'POST' }),
      api('/api/hf',       { method: 'POST' }),
    ]);
    showToast(t('toast.started', 'Started'));
    setTimeout(() => {
      setProgress(false);
      setStatus('ready', t('status.ready'));
      renderHome();  // re-render with fresh data
    }, 8000);
  });
  // Event delegation for tool cards
  $$('.tool-card .tool-cta-run').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const card = btn.closest('.tool-card');
      runTool(card.dataset.route);
    });
  });
}
function toolCard(kind, num, data, opts = {}) {
  const route = `#/${kind}`;
  const meta = TOOL_META[kind];
  const lastLine = data
    ? `${fmtNumber(data.total_unique || data.total || data.unique_repo_count || (data.papers||data.models||[]).length)} items · ${new Date(data.generated_at).toLocaleTimeString()}`
    : '— no data yet';
  const statusLabel = data ? t('status.ready') : t('status.idle', 'Idle');
  const statusState = data ? 'live' : 'idle';
  return `
    <a class="tool-card tool-card-${kind} ${opts.isSpecial ? 'is-special' : ''}" href="${route}">
      <div class="tool-tick"></div>
      <header class="tool-head">
        <span class="tool-num">${num}</span>
        <span class="tool-status" data-state="${statusState}">${escapeHtml(statusLabel)}</span>
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
    <a class="tool-card tool-card-placeholder" href="#/settings">
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
async function runTool(route) {
  const apiMap = {
    '#/pulse':    '/api/ai-daily',
    '#/velocity': '/api/github',
    '#/lab':      '/api/arxiv',
    '#/weights':  '/api/hf',
  };
  const ep = apiMap[route];
  if (!ep) { navigate(route); return; }
  setStatus('busy', t('status.busy'));
  setProgress(true, t('status.busy'));
  const r = await api(ep, { method: 'POST' });
  if (!r.ok) {
    setProgress(false);
    setStatus('error', t('status.error'));
    showToast(r.error || t('toast.failed'), 'error');
    return;
  }
  showToast(t('toast.started'));
  setTimeout(async () => {
    setProgress(false);
    setStatus('ready', t('status.ready'));
    showToast(t('toast.complete'), 'success');
    navigate(route);
  }, 8000);
}

// -----------------------------------------------------------------
// Generic tool page renderer (used by all 4 tool pages + history tab)
// -----------------------------------------------------------------
async function renderToolPage(opts) {
  const { kind, num, tabs, stripData, renderList, canIngest } = opts;
  const meta = TOOL_META[kind];
  const st = state[kind];
  const data = st.viewingSnapshot || st.data;
  const v = $('#view');
  v.innerHTML = `
    <section class="masthead masthead-tool">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span class="tool-num" style="color:var(--accent)">${num}</span>
            <span data-i18n="tool.${kind}.name">${escapeHtml(meta.name)}</span>
            ${st.viewingSnapshot ? `<span class="snapshot-badge" data-i18n="history.badge">viewing snapshot</span>` : ''}
          </h1>
          <p class="mast-sub" data-i18n="tool.${kind}.long">${escapeHtml(meta.long)}</p>
        </div>
        <aside class="mast-right">
          <div class="tool-ctas">
            ${st.viewingSnapshot
              ? `<button class="btn btn-primary" id="backToLive"><span data-i18n="history.back">← back to live</span></button>`
              : (canIngest ? `<button class="btn btn-primary" id="ingestBtn">
                <span class="btn-label" data-i18n="action.ingest">Ingest now</span>
                <span class="btn-arrow">↗</span>
                <span class="btn-spinner"></span>
              </button>
              <button class="btn btn-ghost" id="reloadBtn" data-i18n="action.reload">Re-read cache</button>
              <button class="btn btn-ghost" id="historyBtn" data-i18n="nav.history">History</button>` : '')}
          </div>
        </aside>
      </div>
    </section>
    <div class="panel panel-tool" id="toolPanel">
      <div class="panel-strip" id="strip">${stripData(data)}</div>
      <nav class="tabs" id="tabs">
        ${tabs(data)}
        <div class="tabs-spacer"></div>
        <label class="search">
          <span class="search-ic">⌕</span>
          <input id="toolSearch" type="search" placeholder="${t('action.search')}…" />
          <kbd class="search-kbd">/</kbd>
        </label>
      </nav>
      <div class="list" id="list"></div>
    </div>
  `;
  applyI18n();
  // Now #list exists in the DOM, populate it
  if (renderList) renderList(data, st.query);
  // Wire interactions
  if (canIngest && !st.viewingSnapshot) {
    $('#ingestBtn')?.addEventListener('click', () => runTool('#/' + kind));
    $('#reloadBtn')?.addEventListener('click', async () => {
      st.viewingSnapshot = null;
      await state[`load${kind[0].toUpperCase()+kind.slice(1)}`]();
      PAGES['#/' + kind].render();
      showToast(t('toast.complete'), 'success');
    });
    $('#historyBtn')?.addEventListener('click', () => openHistoryModal(kind));
  }
  $('#backToLive')?.addEventListener('click', () => {
    st.viewingSnapshot = null;
    const targetHash = '#/' + kind;
    if (location.hash === targetHash) {
      route();
    } else {
      location.hash = targetHash;
    }
  });
  $$('#tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('#tabs .tab').forEach(t => t.classList.remove('is-on'));
      tab.classList.add('is-on');
      st.tab = tab.dataset.tab;
      renderList(data, st.query);
    });
  });
  $('#toolSearch')?.addEventListener('input', e => {
    st.query = e.target.value.trim();
    renderList(data, st.query);
  });
}

// -----------------------------------------------------------------
// RENDER — PULSE
// -----------------------------------------------------------------
function renderPulse() {
  const data = state.pulse.viewingSnapshot || state.pulse.data;
  const meta = TOOL_META.pulse;
  const isZh = it => (it.tags || []).includes('zh');
  const stripData = d => {
    if (!d) return [t('panel.generated'), t('panel.sources'), t('panel.items'), t('panel.after_dedup'), t('panel.top_score')].map(k => `
      <div class="strip-cell"><span class="cell-k">${k}</span><span class="cell-v mono">—</span></div>`).join('');
    const lastTop = (d.top_items || [])[0];
    return [
      stripCell(t('panel.generated'), escapeHtml((d.generated_at || '').replace('T',' ').slice(0,16))),
      stripCell(t('panel.sources'), `${d.total_sources} <span class="cell-unit">live</span>`),
      stripCell(t('panel.items'), d.total_raw),
      stripCell(t('panel.after_dedup'), `${d.total_unique} <span class="cell-unit">kept</span>`),
      stripCell(t('panel.top_score'), lastTop ? lastTop.score.toFixed(2) : '—', true),
    ].join('');
  };
  const tabs = d => `
    <button class="tab ${state.pulse.tab==='all'?'is-on':''}" data-tab="all" type="button">${t('pulse.tab.all')} <span class="tab-n mono">${(d?.top_items||[]).length}</span></button>
    <button class="tab ${state.pulse.tab==='zh'?'is-on':''}" data-tab="zh" type="button">${t('pulse.tab.zh')} <span class="tab-n mono">${(d?.chinese_items||[]).length}</span></button>
    <button class="tab ${state.pulse.tab==='en'?'is-on':''}" data-tab="en" type="button">${t('pulse.tab.en')} <span class="tab-n mono">${(d?.english_items||[]).length}</span></button>
  `;
  const getItems = () => {
    let items = state.pulse.tab === 'zh' ? (data?.chinese_items || [])
              : state.pulse.tab === 'en' ? (data?.english_items || [])
              : (data?.top_items || []);
    if (state.pulse.query) {
      const q = state.pulse.query.toLowerCase();
      items = items.filter(it => (it.title||'').toLowerCase().includes(q) || (it.summary||'').toLowerCase().includes(q) || (it.source||'').toLowerCase().includes(q));
    }
    return items;
  };
  const renderList = (d, q) => {
    const items = getItems();
    const list = $('#list');
    if (!items.length) { list.innerHTML = emptyStateHtml(t('pulse.empty.title'), t('pulse.empty.body')); return; }
    list.innerHTML = items.map((it, i) => {
      const zh = isZh(it);
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
            <span class="news-lang ${zh ? 'zh' : 'en'}">${zh ? '中' : 'EN'}</span>
            <span class="news-src">${escapeHtml(it.source || '')}</span>
            ${(it.tags || []).filter(x => x !== 'zh' && x !== 'en').slice(0, 3).map(x => `<span class="news-tag">${escapeHtml(x)}</span>`).join('')}
          </div>
          <h3 class="news-title"><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title || '')}</a></h3>
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
  };
  return renderToolPage({ kind:'pulse', num:'01', tabs, stripData, renderList, canIngest: true });
}

// -----------------------------------------------------------------
// RENDER — VELOCITY
// -----------------------------------------------------------------
function renderVelocity() {
  const data = state.velocity.viewingSnapshot || state.velocity.data;
  const stripData = d => {
    if (!d) return [t('panel.generated'), t('panel.unique'), t('panel.tracks'), t('panel.window'), t('panel.top_score')].map(k => `
      <div class="strip-cell"><span class="cell-k">${k}</span><span class="cell-v mono">—</span></div>`).join('');
    const top = (d.composite_top || [])[0];
    return [
      stripCell(t('panel.generated'), escapeHtml((d.generated_at||'').replace('T',' ').slice(0,16))),
      stripCell(t('panel.unique'), d.unique_repo_count),
      stripCell(t('panel.tracks'), 'A · B'),
      stripCell(t('panel.window'), '7–30d'),
      stripCell(t('panel.top_score'), top ? top.score.toFixed(2) : '—', true),
    ].join('');
  };
  const c = (k) => ((data?.sections || {})[k] || {}).repos?.length || 0;
  const tabs = d => `
    <button class="tab ${state.velocity.tab==='composite'?'is-on':''}" data-tab="composite" type="button">${t('velocity.tab.composite')} <span class="tab-n mono">${(d?.composite_top||[]).length}</span></button>
    <button class="tab ${state.velocity.tab==='trending_daily'?'is-on':''}" data-tab="trending_daily" type="button">${t('velocity.tab.daily')} <span class="tab-n mono">${c('trending_daily')}</span></button>
    <button class="tab ${state.velocity.tab==='trending_weekly'?'is-on':''}" data-tab="trending_weekly" type="button">${t('velocity.tab.weekly')} <span class="tab-n mono">${c('trending_weekly')}</span></button>
    <button class="tab ${state.velocity.tab==='trending_monthly'?'is-on':''}" data-tab="trending_monthly" type="button">${t('velocity.tab.monthly')} <span class="tab-n mono">${c('trending_monthly')}</span></button>
    <button class="tab ${state.velocity.tab==='recent_7d_popular'?'is-on':''}" data-tab="recent_7d_popular" type="button">${t('velocity.tab.recent')} <span class="tab-n mono">${c('recent_7d_popular')}</span></button>
    <button class="tab ${state.velocity.tab==='active_30d'?'is-on':''}" data-tab="active_30d" type="button">${t('velocity.tab.active')} <span class="tab-n mono">${c('active_30d')}</span></button>
  `;
  const getItems = () => {
    let items = state.velocity.tab === 'composite' ? (data?.composite_top || [])
              : ((data?.sections || {})[state.velocity.tab] || {}).repos || [];
    if (state.velocity.query) {
      const q = state.velocity.query.toLowerCase();
      items = items.filter(r => (r.full_name||'').toLowerCase().includes(q) || (r.description||'').toLowerCase().includes(q) || (r.language||'').toLowerCase().includes(q));
    }
    return items;
  };
  const renderList = () => {
    const items = getItems();
    const list = $('#list');
    if (!items.length) { list.innerHTML = emptyStateHtml(t('velocity.empty.title'), t('velocity.empty.body')); return; }
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
  };
  return renderToolPage({ kind:'velocity', num:'02', tabs, stripData, renderList, canIngest: true });
}

// -----------------------------------------------------------------
// RENDER — LAB
// -----------------------------------------------------------------
function renderLab() {
  const data = state.lab.viewingSnapshot || state.lab.data;
  const stripData = d => {
    if (!d) return [t('panel.generated'), t('panel.papers'), t('panel.sources'), t('panel.window'), t('panel.latest')].map(k => `
      <div class="strip-cell"><span class="cell-k">${k}</span><span class="cell-v mono">—</span></div>`).join('');
    const latest = d.papers?.[0];
    return [
      stripCell(t('panel.generated'), escapeHtml((d.generated_at||'').replace('T',' ').slice(0,16))),
      stripCell(t('panel.papers'), d.total),
      stripCell(t('panel.sources'), 'cs.AI · cs.CL'),
      stripCell(t('panel.window'), t('panel.last_7d')),
      stripCell(t('panel.latest'), latest ? (latest.primary_category || 'cs') : '—', true),
    ].join('');
  };
  const tabs = d => `
    <button class="tab ${state.lab.tab==='papers'?'is-on':''}" data-tab="papers" type="button">${t('lab.tab.all')} <span class="tab-n mono">${(d?.papers||[]).length}</span></button>
  `;
  const getItems = () => {
    let items = data?.papers || [];
    if (state.lab.query) {
      const q = state.lab.query.toLowerCase();
      items = items.filter(p => (p.title||'').toLowerCase().includes(q) || (p.authors||[]).join(' ').toLowerCase().includes(q) || (p.summary||'').toLowerCase().includes(q));
    }
    return items;
  };
  const renderList = () => {
    const items = getItems();
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
          <h3 class="news-title"><a href="${escapeHtml(p.url || p.id)}" target="_blank" rel="noopener">${escapeHtml(p.title || '')}</a></h3>
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
  };
  return renderToolPage({ kind:'lab', num:'03', tabs, stripData, renderList, canIngest: true });
}

// -----------------------------------------------------------------
// RENDER — WEIGHTS
// -----------------------------------------------------------------
function renderWeights() {
  const data = state.weights.viewingSnapshot || state.weights.data;
  const stripData = d => {
    if (!d) return [t('panel.generated'), t('panel.models'), t('panel.datasets'), t('panel.papers'), t('panel.sources')].map(k => `
      <div class="strip-cell"><span class="cell-k">${k}</span><span class="cell-v mono">—</span></div>`).join('');
    return [
      stripCell(t('panel.generated'), escapeHtml((d.generated_at||'').replace('T',' ').slice(0,16))),
      stripCell(t('panel.models'), (d.models||[]).length),
      stripCell(t('panel.datasets'), (d.datasets||[]).length),
      stripCell(t('panel.papers'), (d.papers||[]).length),
      stripCell(t('panel.sources'), 'huggingface.co', true),
    ].join('');
  };
  const tabs = d => `
    <button class="tab ${state.weights.tab==='models'?'is-on':''}" data-tab="models" type="button">${t('weights.tab.models')} <span class="tab-n mono">${(d?.models||[]).length}</span></button>
    <button class="tab ${state.weights.tab==='datasets'?'is-on':''}" data-tab="datasets" type="button">${t('weights.tab.datasets')} <span class="tab-n mono">${(d?.datasets||[]).length}</span></button>
    <button class="tab ${state.weights.tab==='papers'?'is-on':''}" data-tab="papers" type="button">${t('weights.tab.papers')} <span class="tab-n mono">${(d?.papers||[]).length}</span></button>
  `;
  const getItems = () => {
    let items = data?.[state.weights.tab] || [];
    if (state.weights.query) {
      const q = state.weights.query.toLowerCase();
      items = items.filter(m => (m.id||'').toLowerCase().includes(q) || (m.description||'').toLowerCase().includes(q));
    }
    return items;
  };
  const renderList = () => {
    const items = getItems();
    const list = $('#list');
    if (!items.length) { list.innerHTML = emptyStateHtml(t('weights.empty.title'), t('weights.empty.body')); return; }
    list.innerHTML = items.slice(0, 30).map((m, i) => `
      <article class="repo-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="repo-rank ${i < 3 ? 'top' : ''}">${String(i+1).padStart(2,'0')}</div>
        <div class="body">
          <div class="repo-meta">
            <span class="lang-chip"><span class="lang-dot" style="background:${langColor(m.language || m.library || '')}"></span>${escapeHtml(m.language || m.library || m.task || 'model')}</span>
            <span class="repo-period">${escapeHtml(m.task || m.task_categories?.[0] || 'trending')}</span>
            <span class="repo-source">via huggingface</span>
          </div>
          <h3 class="repo-title">
            <a href="${escapeHtml(m.url || ('https://huggingface.co/'+(m.id||'')))}" target="_blank" rel="noopener">
              <span class="repo-owner">${escapeHtml((m.id||'').split('/')[0] || '')}/</span><span class="repo-name">${escapeHtml((m.id||'').split('/')[1] || m.id || '')}</span>
            </a>
          </h3>
          ${m.description ? `<p class="repo-desc">${escapeHtml((m.description||'').slice(0, 200))}${(m.description||'').length > 200 ? '…' : ''}</p>` : ''}
        </div>
        <div class="repo-side">
          <div class="repo-stars">${fmtNumber(m.downloads || 0)}<span class="repo-stars-unit">↓</span></div>
          ${m.likes != null ? `<div class="repo-delta">+${fmtNumber(m.likes)} ${t('panel.likes')}</div>` : ''}
          ${m.trending_score != null ? `<div class="repo-composite">${t('panel.trending')} · <span class="v">${(m.trending_score||0).toFixed(2)}</span></div>` : ''}
        </div>
      </article>`).join('');
  };
  return renderToolPage({ kind:'weights', num:'04', tabs, stripData, renderList, canIngest: true });
}

// -----------------------------------------------------------------
// History modal (per-tool)
// -----------------------------------------------------------------
async function openHistoryModal(kind) {
  const snaps = await loadHistoryForKind(kind);
  if (!snaps.length) {
    showToast(t('history.empty.title'), 'error');
    return;
  }
  const modal = document.createElement('div');
  modal.className = 'modal-back';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div>
          <div class="kicker">${t('history.title')} · ${t('tool.' + kind + '.name')}</div>
          <h2 class="modal-title">${snaps.length} ${t('history.col.items')}</h2>
        </div>
        <button class="modal-close" type="button">✕</button>
      </header>
      <div class="modal-body" style="padding:0">
        <div class="hist-snap-list">
          ${snaps.map(s => `
            <div class="hist-snap" data-kind="${escapeHtml(s.kind)}" data-ts="${escapeHtml(s.ts)}">
              <div class="hist-snap-iso mono">${escapeHtml((s.iso || '').replace('T',' ').slice(0,16))}Z</div>
              <div class="hist-snap-meta">
                <span>${s.items ?? 0} items</span>
                <span class="mono">${fmtSize(s.size || 0)}</span>
                <span>${timeAgo(s.iso).rel} ago</span>
              </div>
              <div class="hist-snap-actions">
                <button class="btn btn-primary btn-sm hist-open-snap" type="button" data-kind="${escapeHtml(s.kind)}" data-ts="${escapeHtml(s.ts)}">${t('history.open')}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
  modal.querySelectorAll('.hist-open-snap').forEach(btn => {
    btn.addEventListener('click', async () => {
      const k = btn.dataset.kind, ts = btn.dataset.ts;
      const r = await api(`/api/history/${k}/${ts}`);
      if (r.ok) {
        const kindKey = KIND_DISPLAY[k] || k;
        const st = state[kindKey];
        if (st) {
          st.viewingSnapshot = r.data;
          modal.remove();
          // navigate to the right hash; if already on the page, re-render
          const targetHash = '#/' + kindKey;
          if (location.hash === targetHash) {
            route();
          } else {
            location.hash = targetHash;
          }
        }
      } else {
        showToast('failed to load snapshot', 'error');
      }
    });
  });
}

// -----------------------------------------------------------------
// RENDER — DIGEST
// -----------------------------------------------------------------
function renderDigest() {
  const v = $('#view');
  const has = !!state.digest.content;
  v.innerHTML = `
    <section class="masthead masthead-tool">
      <div class="masthead-inner">
        <div class="mast-left">
          <div class="kicker" data-i18n="home.kicker">Reading Room</div>
          <h1 class="mast-title">
            <span class="tool-num" style="color:var(--accent)">05</span>
            <span data-i18n="tool.digest.name">Daily Digest</span>
          </h1>
          <p class="mast-sub" data-i18n="tool.digest.long">${escapeHtml(TOOL_META.digest.long)}</p>
        </div>
        <aside class="mast-right">
          <div class="tool-ctas">
            ${has ? `<button class="btn btn-ghost" id="digestDownload"><span data-i18n="digest.download">Download</span></button>` : ''}
            <button class="btn btn-primary" id="digestGen">
              <span class="btn-label" data-i18n="digest.generate">Generate today's digest</span>
              <span class="btn-arrow">↗</span>
              <span class="btn-spinner"></span>
            </button>
          </div>
        </aside>
      </div>
    </section>
    <div class="panel panel-digest">
      <div class="digest-meta">
        <span class="kicker">${state.digest.date ? state.digest.date : t('digest.empty')}</span>
      </div>
      <pre class="digest-pre">${escapeHtml(state.digest.content || '—')}</pre>
    </div>
  `;
  applyI18n();
  $('#digestGen').addEventListener('click', async () => {
    setStatus('busy', t('status.busy'));
    setProgress(true, t('status.busy'));
    await api('/api/digest/generate', { method: 'POST' });
    showToast(t('toast.started'));
    setTimeout(async () => {
      await loadDigest();
      setProgress(false);
      setStatus('ready', t('status.ready'));
      showToast(t('toast.complete'), 'success');
      renderDigest();
    }, 5000);
  });
  $('#digestDownload')?.addEventListener('click', () => {
    if (!state.digest.content) { showToast(t('digest.empty'), 'error'); return; }
    const blob = new Blob([state.digest.content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `insight-digest-${state.digest.date || 'today'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// -----------------------------------------------------------------
// RENDER — SETTINGS
// -----------------------------------------------------------------
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
            ${ACCENT_CYCLE.map(a => `<button class="seg ${state.accent===a ? 'is-on' : ''}" data-accent="${a}" type="button"><span class="seg-dot" style="background:${ACCENT_PALETTES[a].color}"></span> ${t('settings.accent.'+a, a)}</button>`).join('')}
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
          <p class="settings-body" data-i18n="settings.about.body">A reading room for the curious…</p>
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
    state.theme = b.dataset.theme; applyTheme(); savePrefs(); renderSettings();
  }));
  $$('.seg[data-accent]').forEach(b => b.addEventListener('click', () => {
    state.accent = b.dataset.accent; applyAccent(); savePrefs(); renderSettings();
  }));
  $$('.seg[data-lang]').forEach(b => b.addEventListener('click', async () => {
    state.lang = b.dataset.lang; savePrefs(); await loadI18n();
    // re-render whatever page we're on
    if (location.hash.startsWith('#/settings')) renderSettings();
    else route();
  }));
  $('#resetBookmarks')?.addEventListener('click', () => {
    state.bookmarks = { news: new Set(), github: new Set(), papers: new Set() };
    persistBookmarks();
    showToast('Bookmarks reset', 'success');
    renderSettings();
  });
}

// -----------------------------------------------------------------
// Bookmarks
// -----------------------------------------------------------------
function bindBookmarkBtns(root) {
  $$('.bk-btn', root).forEach(btn => {
    btn.addEventListener('click', e => {
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

// -----------------------------------------------------------------
// Init
// -----------------------------------------------------------------
async function init() {
  const prefs = loadPrefs();
  if (prefs.lang) state.lang = prefs.lang;
  if (prefs.theme) state.theme = prefs.theme;
  if (prefs.accent) state.accent = prefs.accent;
  state.bookmarks = loadBookmarks();
  applyTheme();
  applyAccent();
  await loadI18n();
  startClock();
  setStatus('idle', t('status.connecting'));
  // top-level: theme, accent, language controls
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#accentBtn').addEventListener('click', cycleAccent);
  $$('.lang-btn').forEach(b => b.addEventListener('click', async () => {
    state.lang = b.dataset.lang; savePrefs(); await loadI18n();
    if (location.hash.startsWith('#/settings')) renderSettings();
    else route();
  }));
  // keyboard shortcut
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      $('#toolSearch')?.focus();
    }
  });
  if (!location.hash) location.hash = '#/';
  setStatus('ready', t('status.ready'));
  await route();
}
document.addEventListener('DOMContentLoaded', init);
