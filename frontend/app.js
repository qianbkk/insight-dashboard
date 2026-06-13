/* Insight // Operator's Console — frontend logic */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  ai:  { data: null, tab: 'all',     query: '', bookmarks: new Set() },
  gh:  { data: null, tab: 'composite', query: '', bookmarks: new Set() },
  arx: { data: null, tab: 'papers',  query: '', bookmarks: new Set() },
  hf:  { data: null, tab: 'models',  query: '', bookmarks: new Set() },
};

// -------- bookmarks (localStorage) --------
const BK_KEY = 'insight_bookmarks_v1';
const loadBookmarks = () => {
  try {
    const raw = localStorage.getItem(BK_KEY);
    if (!raw) return { news: new Set(), github: new Set(), papers: new Set() };
    const obj = JSON.parse(raw);
    return {
      news: new Set(obj.news || []),
      github: new Set(obj.github || []),
      papers: new Set(obj.papers || []),
    };
  } catch {
    return { news: new Set(), github: new Set(), papers: new Set() };
  }
};
const allBookmarks = loadBookmarks();
state.ai.bookmarks = allBookmarks.news;
state.gh.bookmarks = allBookmarks.github;
state.arx.bookmarks = allBookmarks.papers;
state.hf.bookmarks = new Set();

function isBookmarked(kind, id) {
  const map = kind === 'news' ? state.ai.bookmarks
    : kind === 'github' ? state.gh.bookmarks
    : kind === 'paper' ? state.arx.bookmarks
    : state.hf.bookmarks;
  return map ? map.has(id) : false;
}
function toggleBookmark(kind, id) {
  const map = kind === 'news' ? state.ai.bookmarks
    : kind === 'github' ? state.gh.bookmarks
    : kind === 'paper' ? state.arx.bookmarks
    : state.hf.bookmarks;
  if (!map) return false;
  if (map.has(id)) { map.delete(id); return false; }
  map.add(id); return true;
}
function persistAll() {
  try {
    localStorage.setItem(BK_KEY, JSON.stringify({
      news: Array.from(state.ai.bookmarks),
      github: Array.from(state.gh.bookmarks),
      papers: Array.from(state.arx.bookmarks),
    }));
  } catch {}
}

// -------- utils --------
const escapeHtml = s => s == null ? '' : String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

function timeAgo(iso) {
  if (!iso) return { rel: '—', cls: 'stale', exact: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { rel: '—', cls: 'stale', exact: '' };
  const diff = (Date.now() - d.getTime()) / 1000;
  let rel, cls = 'stale';
  if (diff < 0) rel = 'soon';
  else if (diff < 60) rel = 'now';
  else if (diff < 3600) { rel = Math.floor(diff / 60) + 'm'; cls = 'fresh'; }
  else if (diff < 86400) { rel = Math.floor(diff / 3600) + 'h'; cls = 'fresh'; }
  else if (diff < 86400 * 7) rel = Math.floor(diff / 86400) + 'd';
  else if (diff < 86400 * 30) rel = Math.floor(diff / (86400 * 7)) + 'w';
  else rel = Math.floor(diff / (86400 * 30)) + 'mo';
  return { rel, cls, exact: d.toISOString().replace('T', ' ').slice(0, 16) + 'Z' };
}
const fmtNumber = n => {
  if (n == null) return '—';
  n = Number(n);
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'k';
  return String(n);
};

// language → color (GitHub-ish but refined)
const LANG_COLORS = {
  Python: '#3572A5', JavaScript: '#f1e05a', TypeScript: '#3178c6',
  Go: '#00ADD8', Rust: '#dea584', Java: '#b07219', 'C++': '#f34b7d',
  'C#': '#178600', C: '#555555', Shell: '#89e051', Swift: '#F05138',
  Kotlin: '#A97BFF', Ruby: '#701516', PHP: '#4F5D95', HTML: '#e34c26',
  CSS: '#563d7c', SCSS: '#c6538c', Lua: '#000080', Dart: '#00B4AB',
  Scala: '#c22d40', Elixir: '#6e4a7e', Haskell: '#5e5086', Clojure: '#db5855',
  Jupyter: '#DA5B0B', R: '#198CE7', MATLAB: '#e16737',
};
function langColor(name) { return LANG_COLORS[name] || '#8b94a7'; }

// -------- toast + status --------
let toastTimer = null;
function showToast(msg, type = '') {
  const el = $('#toast');
  $('.toast-msg', el).textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + type; }, 2600);
}
function setStatus(state, label, meta = '') {
  const el = $('#status');
  el.dataset.state = state;
  $('#statusLabel').textContent = label;
  $('#statusMeta').textContent = meta;
}
function setProgress(visible, label) {
  const el = $('#progress');
  el.hidden = !visible;
  if (label) $('#progressLabel').textContent = label;
}

// -------- clock --------
function startClock() {
  const tick = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    $('.clock-hm').textContent = `${hh}:${mm}`;
    $('.clock-s').textContent = ss;
  };
  tick();
  setInterval(tick, 1000);
}

// -------- api --------
async function api(path, opts = {}) {
  try {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    let json = {};
    try { json = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { message: String(e) } };
  }
}

async function pollState(target, onDone) {
  let attempts = 0;
  const handle = setInterval(async () => {
    attempts++;
    const { json } = await api('/api/status');
    const s = json.state?.[target];
    if (!s || s.status === 'running') {
      if (attempts > 180) { clearInterval(handle); onDone(false, 'timeout'); }
      return;
    }
    clearInterval(handle);
    onDone(s.status === 'success', s.error || null);
  }, 1500);
}

function bindBtn(btnId, endpoint, label) {
  const btn = $('#' + btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    btn.disabled = true;
    setStatus('busy', label + '…', 'working');
    setProgress(true, label + ' in progress');
    const { ok, json } = await api(endpoint, { method: 'POST' });
    if (!ok) {
      btn.classList.remove('loading'); btn.disabled = false;
      setStatus('error', 'failed', '');
      setProgress(false);
      showToast(json.message || 'trigger failed', 'error');
      return;
    }
    showToast(label + ' started');
    pollState(endpoint.includes('ai') ? 'ai_daily' : endpoint.includes('arxiv') ? 'arxiv' : 'github',
      async (success, err) => {
        btn.classList.remove('loading'); btn.disabled = false;
        setProgress(false);
        if (success) {
          setStatus('ready', 'ready', 'fresh data');
          showToast(label + ' complete', 'success');
          if (endpoint.includes('ai')) await loadAi();
          else if (endpoint.includes('arxiv')) await loadArxiv();
          else if (endpoint.includes('github')) await loadGh();
        } else {
          setStatus('error', 'failed', '');
          showToast('failed: ' + (err || 'unknown'), 'error');
        }
      });
  });
}

// -------- loaders --------
async function loadAi() {
  const { ok, json } = await api('/api/ai-daily/data');
  if (!ok) { renderEmpty($('#aiList'), 'no digest', 'Click “Ingest now” to fetch the multi-source digest.'); return; }
  state.ai.data = json.data;
  renderAiMeta(); renderAiCounts(); renderAiList();
}
async function loadGh() {
  const { ok, json } = await api('/api/github/data');
  if (!ok) { renderEmpty($('#ghList'), 'no index', 'Click “Ingest now” to fetch trending + REST results.'); return; }
  state.gh.data = json.data;
  renderGhMeta(); renderGhCounts(); renderGhList();
}
async function loadArxiv() {
  const { ok, json } = await api('/api/arxiv/data');
  const list = $('#arxList'); if (!list) return;
  if (!ok) { renderEmpty(list, 'no arXiv', 'Click “Ingest now” to fetch recent cs.AI / cs.CL papers.'); return; }
  state.arx.data = json.data;
  renderArxivMeta(); renderArxivList();
}
async function loadHf() {
  const { ok, json } = await api('/api/hf/data');
  const list = $('#hfList'); if (!list) return;
  if (!ok) { renderEmpty(list, 'no HF', 'Click “Ingest now” to fetch trending models + datasets.'); return; }
  state.hf.data = json.data;
  renderHfMeta(); renderHfList();
}

function renderEmpty(root, title, body) {
  root.innerHTML = `
    <div class="empty" data-state="rest">
      <div class="empty-mark">∅</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </div>`;
}

// -------- AI render --------
function renderAiMeta() {
  const d = state.ai.data;
  $('#mSources').textContent = d.total_sources || '—';
  $('#mIngest').textContent = d.generated_at
    ? new Date(d.generated_at).toLocaleString('en-GB', { hour12: false })
    : '—';
  $('#aiGenerated').textContent = d.generated_at
    ? new Date(d.generated_at).toLocaleString('en-GB', { hour12: false }).replace(',', '')
    : '—';
  $('#aiGenerated').title = d.generated_at || '';
  $('#aiSources').textContent = d.total_sources;
  $('#aiRaw').textContent = d.total_raw;
  $('#aiUnique').textContent = d.total_unique;
  const top = (d.top_items || [])[0];
  $('#aiTopScore').textContent = top ? top.score.toFixed(2) : '—';
}
function renderAiCounts() {
  $('#cntAll').textContent = (state.ai.data.top_items || []).length;
  $('#cntZh').textContent  = (state.ai.data.chinese_items || []).length;
  $('#cntEn').textContent  = (state.ai.data.english_items || []).length;
}
function getAiItems() {
  if (!state.ai.data) return [];
  const { tab, query } = state.ai;
  let items;
  if (tab === 'zh') items = state.ai.data.chinese_items;
  else if (tab === 'en') items = state.ai.data.english_items;
  else items = state.ai.data.top_items;
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(it =>
      (it.title || '').toLowerCase().includes(q) ||
      (it.summary || '').toLowerCase().includes(q) ||
      (it.source || '').toLowerCase().includes(q)
    );
  }
  return items;
}
function renderAiList() {
  const items = getAiItems();
  const list = $('#aiList');
  if (!items || !items.length) { renderEmpty(list, 'no matches', 'Try clearing the search or switching tabs.'); return; }
  list.innerHTML = items.map((it, i) => {
    const isZh = (it.tags || []).includes('zh');
    const ago = timeAgo(it.published);
    const id = it.url_hash || it.url;
    const bookmarked = isBookmarked('news', id);
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
            ${(it.tags || []).filter(t => t !== 'zh' && t !== 'en').map(t => `<span class="news-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
          <h3 class="news-title">
            <a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title || '')}</a>
          </h3>
          ${it.summary ? `<p class="news-summary">${escapeHtml(it.summary)}</p>` : ''}
        </div>
        <div class="news-side">
          <button class="bk-btn ${bookmarked ? 'on' : ''}" data-id="${escapeHtml(id)}" data-kind="news" title="Bookmark">${bookmarked ? '★' : '☆'}</button>
          <span class="news-ago ${ago.cls}">${ago.rel}</span>
          <span class="news-time" title="${ago.exact}">${ago.exact.slice(11, 16)}Z</span>
          ${it.author ? `<span class="news-author">${escapeHtml(it.author)}</span>` : ''}
        </div>
      </article>
    `;
  }).join('');
  bindBookmarkBtns(list);
}

// -------- GitHub render --------
function renderGhMeta() {
  const d = state.gh.data;
  $('#ghGenerated').textContent = d.generated_at
    ? new Date(d.generated_at).toLocaleString('en-GB', { hour12: false }).replace(',', '')
    : '—';
  $('#ghGenerated').title = d.generated_at || '';
  $('#ghUnique').textContent = d.unique_repo_count;
  const top = (d.composite_top || [])[0];
  $('#ghTopScore').textContent = top ? (top.score || 0).toFixed(2) : '—';
  renderGhCounts();
}
function renderGhCounts() {
  const d = state.gh.data;
  const c = (k) => ((d.sections || {})[k] || {}).repos?.length || 0;
  $('#cntComposite').textContent = (d.composite_top || []).length;
  $('#cntDaily').textContent = c('trending_daily');
  $('#cntWeekly').textContent = c('trending_weekly');
  $('#cntMonthly').textContent = c('trending_monthly');
  $('#cntRecent').textContent = c('recent_7d_popular');
  $('#cntActive').textContent = c('active_30d');
}
function getGhItems() {
  if (!state.gh.data) return [];
  const { tab, query } = state.gh;
  let items;
  if (tab === 'composite') items = state.gh.data.composite_top;
  else { const sec = state.gh.data.sections[tab]; items = sec ? sec.repos : []; }
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(r =>
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q) ||
      (r.language || '').toLowerCase().includes(q)
    );
  }
  return items;
}
function sparkline(points, w = 80, h = 22) {
  if (!points || points.length === 0) return '';
  const stroke = points.length >= 2 && points[points.length - 1] >= points[0]
    ? 'var(--signal)' : (points.length >= 2 ? 'var(--bad)' : 'var(--txt-3)');
  if (points.length === 1) {
    // 单点显示为圆点
    return `
      <svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
        <circle cx="${w/2}" cy="${h/2}" r="3" fill="${stroke}"/>
        <text x="${w/2}" y="${h-2}" text-anchor="middle" font-size="6" fill="var(--txt-4)" font-family="var(--font-mono)">1pt</text>
      </svg>`;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = (max - min) || 1;
  const dx = w / (points.length - 1);
  const pts = points.map((v, i) => `${(i * dx).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`);
  const areaPts = [`0,${h}`, ...pts, `${w},${h}`].join(' ');
  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
      <polygon points="${areaPts}" fill="${stroke}" fill-opacity="0.12"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}
function renderGhList() {
  const items = getGhItems();
  const list = $('#ghList');
  if (!items || !items.length) { renderEmpty(list, 'no matches', 'Try clearing the search or switching tabs.'); return; }
  const composite = state.gh.tab === 'composite';
  list.innerHTML = items.map((r, i) => {
    const ps = r.today_stars || r.weekly_stars || r.monthly_stars || 0;
    const total = r.total_stars || r.stars || 0;
    const id = r.full_name;
    const bookmarked = isBookmarked('github', id);
    const spark = sparkline(r.star_history || []);
    return `
      <article class="repo-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="repo-rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</div>
        <div class="repo-body">
          <div class="repo-meta">
            ${r.language ? `<span class="lang-chip"><span class="lang-dot" style="background:${langColor(r.language)};--lang-color:${langColor(r.language)}"></span>${escapeHtml(r.language)}</span>` : ''}
            <span class="repo-period">${escapeHtml(r.period || 'window')}</span>
            ${r.source ? `<span class="repo-source ${escapeHtml(r.source)}">via ${escapeHtml(r.source)}</span>` : ''}
            ${spark ? `<span class="repo-spark" title="recent star trajectory">${spark}</span>` : ''}
          </div>
          <h3 class="repo-title">
            <a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">
              <span class="repo-owner">${escapeHtml((r.full_name || '').split('/')[0] || '')}/</span><span class="repo-name">${escapeHtml((r.full_name || '').split('/')[1] || r.full_name || '')}</span>
            </a>
          </h3>
          ${r.description ? `<p class="repo-desc">${escapeHtml(r.description)}</p>` : ''}
        </div>
        <div class="repo-side">
          <button class="bk-btn ${bookmarked ? 'on' : ''}" data-id="${escapeHtml(id)}" data-kind="github" title="Bookmark">${bookmarked ? '★' : '☆'}</button>
          <div class="repo-stars">${fmtNumber(total)}<span class="repo-stars-unit">★</span></div>
          ${ps ? `<div class="repo-delta">+${fmtNumber(ps)}<span> · </span><span class="mono">${escapeHtml(r.period || '')}</span></div>` : '<div class="repo-delta zero">no delta</div>'}
          ${composite ? `<div class="repo-composite">composite · <span class="v">${(r.score || 0).toFixed(2)}</span></div>` : ''}
        </div>
      </article>
    `;
  }).join('');
  bindBookmarkBtns(list);
}

// -------- arXiv render --------
function renderArxivMeta() {
  const d = state.arx.data;
  $('#arxGenerated').textContent = d.generated_at
    ? new Date(d.generated_at).toLocaleString('en-GB', { hour12: false }).replace(',', '')
    : '—';
  $('#arxPapers').textContent = (d.papers || []).length;
}
function renderArxivList() {
  const items = state.arx.data.papers || [];
  const list = $('#arxList');
  if (!items.length) { renderEmpty(list, 'no papers', 'Click “Ingest now” to fetch recent arXiv submissions.'); return; }
  list.innerHTML = items.slice(0, 30).map((p, i) => {
    const ago = timeAgo(p.published);
    const id = p.id || p.url;
    const bookmarked = isBookmarked('paper', id);
    return `
      <article class="news-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="news-score">
          <div class="news-score-val" style="color:var(--signal)">${escapeHtml((p.primary_category || 'cs').slice(0, 4))}</div>
          <div class="news-score-bar" style="--w:${Math.min(100, (p.heat || 0.5) * 100)}%; background:linear-gradient(90deg, var(--signal) 0%, var(--amber) 100%)"></div>
        </div>
        <div class="news-body">
          <div class="news-meta">
            <span class="news-lang en">arXiv</span>
            <span class="news-src">${escapeHtml(p.primary_category || '')}</span>
            <span class="news-tag">${(p.categories || []).slice(0, 3).map(escapeHtml).join(' · ')}</span>
          </div>
          <h3 class="news-title">
            <a href="${escapeHtml(p.url || p.id)}" target="_blank" rel="noopener">${escapeHtml(p.title || '')}</a>
          </h3>
          <p class="news-summary">${escapeHtml((p.summary || '').slice(0, 240))}${(p.summary || '').length > 240 ? '…' : ''}</p>
        </div>
        <div class="news-side">
          <button class="bk-btn ${bookmarked ? 'on' : ''}" data-id="${escapeHtml(id)}" data-kind="paper" title="Bookmark">${bookmarked ? '★' : '☆'}</button>
          <span class="news-ago ${ago.cls}">${ago.rel}</span>
          <span class="news-time">${ago.exact.slice(11, 16)}Z</span>
          <span class="news-author" style="max-width:120px">${escapeHtml((p.authors || []).slice(0, 2).join(', '))}${(p.authors || []).length > 2 ? ' +' + (p.authors.length - 2) : ''}</span>
        </div>
      </article>
    `;
  }).join('');
  bindBookmarkBtns(list);
}

// -------- HF render --------
function renderHfMeta() {
  const d = state.hf.data;
  $('#hfGenerated').textContent = d.generated_at
    ? new Date(d.generated_at).toLocaleString('en-GB', { hour12: false }).replace(',', '')
    : '—';
  $('#hfModels').textContent = (d.models || []).length;
  $('#hfDatasets').textContent = (d.datasets || []).length;
  $('#hfPapers').textContent = (d.papers || []).length;
}
function renderHfList() {
  const tab = state.hf.tab;
  const items = state.hf.data[tab] || [];
  const list = $('#hfList');
  if (!items.length) { renderEmpty(list, 'no data', 'Click “Ingest now” to fetch HuggingFace trending.'); return; }
  const langColorFor = (lang) => LANG_COLORS[lang] || '#8b94a7';
  list.innerHTML = items.slice(0, 30).map((m, i) => {
    const id = m.id || m.name;
    return `
      <article class="repo-card" style="animation-delay:${Math.min(i, 12) * 22}ms">
        <div class="repo-rank ${i < 3 ? 'top' : ''}">${String(i + 1).padStart(2, '0')}</div>
        <div class="repo-body">
          <div class="repo-meta">
            <span class="lang-chip"><span class="lang-dot" style="background:${langColorFor(m.language || m.library || '')};--lang-color:${langColorFor(m.language || m.library || '')}"></span>${escapeHtml(m.language || m.library || m.task || 'model')}</span>
            <span class="repo-period">${escapeHtml(m.trend || 'trending')}</span>
            <span class="repo-source">via huggingface</span>
          </div>
          <h3 class="repo-title">
            <a href="${escapeHtml(m.url || ('https://huggingface.co/' + id))}" target="_blank" rel="noopener">
              <span class="repo-owner">${escapeHtml((id || '').split('/')[0] || '')}/</span><span class="repo-name">${escapeHtml((id || '').split('/')[1] || id || '')}</span>
            </a>
          </h3>
          ${m.description ? `<p class="repo-desc">${escapeHtml((m.description || '').slice(0, 200))}</p>` : ''}
        </div>
        <div class="repo-side">
          <div class="repo-stars">${fmtNumber(m.downloads || 0)}<span class="repo-stars-unit">↓</span></div>
          ${m.likes != null ? `<div class="repo-delta">+${fmtNumber(m.likes)} likes</div>` : ''}
          ${m.trending_score != null ? `<div class="repo-composite">trending · <span class="v">${(m.trending_score || 0).toFixed(2)}</span></div>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

// -------- bookmark button binding --------
function bindBookmarkBtns(root) {
  $$('.bk-btn', root).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const kind = btn.dataset.kind;
      const id = btn.dataset.id;
      const added = toggleBookmark(kind, id);
      persistAll();
      btn.classList.toggle('on', added);
      btn.textContent = added ? '★' : '☆';
      showToast(added ? 'Bookmarked' : 'Removed');
    });
  });
}

// -------- export bookmarks --------
function exportBookmarks() {
  const all = [];
  for (const [kind, set] of [['news', state.ai.bookmarks], ['github', state.gh.bookmarks], ['papers', state.arx.bookmarks]]) {
    for (const id of set) {
      all.push({ kind, id, ts: new Date().toISOString() });
    }
  }
  if (!all.length) { showToast('No bookmarks yet', 'error'); return; }
  // Try to find title/url from loaded data
  const enrich = (kind, id) => {
    if (kind === 'news') {
      const it = (state.ai.data?.top_items || []).find(x => (x.url_hash || x.url) === id);
      return it ? { title: it.title, url: it.url, source: it.source } : {};
    }
    if (kind === 'github') {
      const r = (state.gh.data?.composite_top || []).find(x => x.full_name === id)
        || Object.values(state.gh.data?.sections || {}).flatMap(s => s.repos).find(x => x.full_name === id);
      return r ? { title: r.full_name, url: r.html_url, source: 'GitHub' } : {};
    }
    if (kind === 'paper') {
      const p = (state.arx.data?.papers || []).find(x => (x.id || x.url) === id);
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
  a.download = `insight-bookmarks-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('Bookmarks exported as Markdown', 'success');
}

// -------- tab / search binding --------
function bindTabs(tabsId, stateKey, renderFn) {
  const tabs = $$('#' + tabsId + ' .tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-on'));
      tab.classList.add('is-on');
      state[stateKey].tab = tab.dataset.tab;
      renderFn();
    });
  });
}
function bindSearch(inputId, stateKey, renderFn) {
  const input = $('#' + inputId);
  input.addEventListener('input', e => {
    state[stateKey].query = e.target.value.trim();
    renderFn();
  });
}
function bindKeyboardShortcut() {
  let focused = false;
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !focused) {
      e.preventDefault();
      const inp = $('input.search-input, .search input');
      if (inp) inp.focus();
    }
  });
  $$('input').forEach(i => i.addEventListener('focus', () => focused = true));
  $$('input').forEach(i => i.addEventListener('blur', () => focused = false));
}

// -------- bootstrap --------
async function init() {
  startClock();
  setStatus('idle', 'connecting', '— — —');

  // bind fetcher buttons
  bindBtn('btnFetchAi', '/api/ai-daily', 'AI Pulse ingest');
  bindBtn('btnFetchGh', '/api/github', 'Code Velocity ingest');
  bindBtn('btnFetchArx', '/api/arxiv', 'arXiv ingest');
  bindBtn('btnFetchHf', '/api/hf', 'HuggingFace ingest');

  // reload buttons
  $('#btnReloadAi')?.addEventListener('click', async () => { await loadAi(); showToast('AI cache reloaded'); });
  $('#btnReloadGh')?.addEventListener('click', async () => { await loadGh(); showToast('GitHub cache reloaded'); });
  $('#btnReloadArx')?.addEventListener('click', async () => { await loadArxiv(); showToast('arXiv cache reloaded'); });
  $('#btnReloadHf')?.addEventListener('click', async () => { await loadHf(); showToast('HF cache reloaded'); });

  // tabs + search
  bindTabs('aiTabs', 'ai', renderAiList);
  bindSearch('aiSearch', 'ai', renderAiList);
  bindTabs('ghTabs', 'gh', renderGhList);
  bindSearch('ghSearch', 'gh', renderGhList);
  bindTabs('arxTabs', 'arx', renderArxivList);
  bindSearch('arxSearch', 'arx', renderArxivList);
  bindTabs('hfTabs', 'hf', renderHfList);
  bindSearch('hfSearch', 'hf', renderHfList);

  // bookmarks
  $('#btnExportBookmarks')?.addEventListener('click', exportBookmarks);

  // keyboard
  bindKeyboardShortcut();

  // load cached
  await Promise.all([loadAi(), loadGh(), loadArxiv(), loadHf()]);
  setStatus('ready', 'ready', 'all cached');
}

document.addEventListener('DOMContentLoaded', init);
