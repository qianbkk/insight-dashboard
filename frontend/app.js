/* Insight Dashboard — 前端逻辑 */

const state = {
  ai: { data: null, tab: 'all', query: '' },
  gh: { data: null, tab: 'composite', query: '' },
  pollHandle: null,
};

// -------- 工具 --------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 0) return '刚刚';
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
  if (diff < 86400 * 365) return Math.floor(diff / (86400 * 30)) + ' 月前';
  return Math.floor(diff / (86400 * 365)) + ' 年前';
}

function fmtNumber(n) {
  if (n == null) return '—';
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function showToast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = 'toast ' + type; }, 2400);
}

function setGlobalStatus(state, label) {
  const pill = $('#globalStatus');
  pill.className = 'status-pill ' + (state || '');
  pill.querySelector('.label').textContent = label;
}

// -------- API --------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, json };
}

async function fetchAi() {
  const btn = $('#btnFetchAi');
  btn.classList.add('loading');
  btn.disabled = true;
  setGlobalStatus('busy', 'AI 日报抓取中...');
  showToast('开始抓取 AI 日报，预计 30–60 秒');
  const { ok, json } = await api('/api/ai-daily', { method: 'POST' });
  if (!ok) {
    showToast(json.message || '触发失败', 'error');
    btn.classList.remove('loading');
    btn.disabled = false;
    setGlobalStatus('error', 'AI 抓取失败');
    return;
  }
  // 轮询状态
  pollState('ai');
}

async function fetchGh() {
  const btn = $('#btnFetchGh');
  btn.classList.add('loading');
  btn.disabled = true;
  setGlobalStatus('busy', 'GitHub 热门抓取中...');
  showToast('开始抓取 GitHub 热门，预计 15–30 秒');
  const { ok, json } = await api('/api/github', { method: 'POST' });
  if (!ok) {
    showToast(json.message || '触发失败', 'error');
    btn.classList.remove('loading');
    btn.disabled = false;
    setGlobalStatus('error', 'GitHub 抓取失败');
    return;
  }
  pollState('gh');
}

async function pollState(which) {
  const target = which === 'ai' ? 'ai_daily' : 'github';
  const btnFetch = which === 'ai' ? $('#btnFetchAi') : $('#btnFetchGh');
  const load = which === 'ai' ? loadAi : loadGh;
  let attempts = 0;
  const handle = setInterval(async () => {
    attempts++;
    const { json } = await api('/api/status');
    const s = json.state[target];
    if (s.status === 'running') {
      if (attempts > 120) { clearInterval(handle); return; } // 2分钟超时
      return;
    }
    clearInterval(handle);
    btnFetch.classList.remove('loading');
    btnFetch.disabled = false;
    if (s.status === 'success') {
      showToast(`${which === 'ai' ? 'AI 日报' : 'GitHub 热门'}抓取完成`, 'success');
      await load();
      setGlobalStatus('', '就绪');
    } else {
      showToast(`抓取失败: ${s.error || '未知错误'}`, 'error');
      setGlobalStatus('error', '抓取失败');
    }
  }, 1500);
}

async function loadAi() {
  const { ok, json } = await api('/api/ai-daily/data');
  if (!ok) {
    $('#aiList').innerHTML = '<div class="empty">尚无数据，点击「立即抓取」</div>';
    return;
  }
  state.ai.data = json.data;
  renderAiMeta();
  renderAiList();
}

async function loadGh() {
  const { ok, json } = await api('/api/github/data');
  if (!ok) {
    $('#ghList').innerHTML = '<div class="empty">尚无数据，点击「立即抓取」</div>';
    return;
  }
  state.gh.data = json.data;
  renderGhMeta();
  renderGhList();
}

// -------- 渲染 --------
function renderAiMeta() {
  const d = state.ai.data;
  $('#aiGenerated').textContent = d.generated_at ? new Date(d.generated_at).toLocaleString() : '—';
  $('#aiGenerated').title = d.generated_at || '';
  $('#aiSources').textContent = d.total_sources;
  $('#aiRaw').textContent = d.total_raw;
  $('#aiUnique').textContent = d.total_unique;
}

function renderGhMeta() {
  const d = state.gh.data;
  $('#ghGenerated').textContent = d.generated_at ? new Date(d.generated_at).toLocaleString() : '—';
  $('#ghGenerated').title = d.generated_at || '';
  $('#ghUnique').textContent = d.unique_repo_count;
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
  if (!items || items.length === 0) {
    list.innerHTML = '<div class="empty">无匹配结果</div>';
    return;
  }
  list.innerHTML = items.map((it, i) => {
    const lang = (it.tags || []).includes('zh') ? '中文' : 'EN';
    return `
      <div class="news-card">
        <div class="score">
          <div class="val">${(it.score || 0).toFixed(2)}</div>
          <div class="lbl">SCORE</div>
        </div>
        <div class="body">
          <div class="src">
            <span class="lang">● ${lang}</span>
            <span>${escapeHtml(it.source || '')}</span>
            <span class="dotsep"></span>
            <span>${(it.tags || []).join(' · ')}</span>
          </div>
          <h3><a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title || '')}</a></h3>
          ${it.summary ? `<div class="summary">${escapeHtml(it.summary)}</div>` : ''}
        </div>
        <div class="meta">
          <span class="ago">${timeAgo(it.published)}</span>
          ${it.author ? `<span>${escapeHtml(it.author.slice(0, 20))}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function getGhItems() {
  if (!state.gh.data) return [];
  const { tab, query } = state.gh;
  let items;
  if (tab === 'composite') {
    items = state.gh.data.composite_top;
  } else {
    const sec = state.gh.data.sections[tab];
    items = sec ? sec.repos : [];
  }
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(it =>
      (it.full_name || '').toLowerCase().includes(q) ||
      (it.description || '').toLowerCase().includes(q) ||
      (it.language || '').toLowerCase().includes(q)
    );
  }
  return items;
}

function renderGhList() {
  const items = getGhItems();
  const list = $('#ghList');
  if (!items || items.length === 0) {
    list.innerHTML = '<div class="empty">无匹配结果</div>';
    return;
  }
  const composite = state.gh.tab === 'composite';
  list.innerHTML = items.map((r, i) => {
    const periodStars = r.today_stars || r.weekly_stars || r.monthly_stars || 0;
    const total = r.total_stars || r.stars || 0;
    const periodLabel = r.period || '';
    return `
      <div class="repo-card">
        <div class="body">
          <div class="top">
            <span class="rank">#${i + 1}</span>
            ${r.language ? `<span class="lang">● ${escapeHtml(r.language)}</span><span class="dotsep"></span>` : ''}
            <span>${escapeHtml(periodLabel)}</span>
            ${r.source ? `<span class="dotsep"></span><span>via ${escapeHtml(r.source)}</span>` : ''}
          </div>
          <h3><a href="${escapeHtml(r.html_url)}" target="_blank" rel="noopener">${escapeHtml(r.full_name)}</a></h3>
          ${r.description ? `<div class="desc">${escapeHtml(r.description)}</div>` : ''}
        </div>
        <div class="stats">
          <div class="total">${fmtNumber(total)}<span class="unit">★</span></div>
          ${periodStars ? `<div class="period">+${fmtNumber(periodStars)} 期间内</div>` : ''}
          ${composite ? `<div class="composite">综合 ${(r.score || 0).toFixed(2)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// -------- 事件 --------
function bind() {
  // AI
  $('#btnFetchAi').addEventListener('click', fetchAi);
  $('#btnReloadAi').addEventListener('click', async () => { await loadAi(); showToast('已读取最新缓存'); });
  $$('#aiTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('#aiTabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.ai.tab = tab.dataset.tab;
      renderAiList();
    });
  });
  $('#aiSearch').addEventListener('input', e => {
    state.ai.query = e.target.value.trim();
    renderAiList();
  });

  // GitHub
  $('#btnFetchGh').addEventListener('click', fetchGh);
  $('#btnReloadGh').addEventListener('click', async () => { await loadGh(); showToast('已读取最新缓存'); });
  $$('#ghTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('#ghTabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.gh.tab = tab.dataset.tab;
      renderGhList();
    });
  });
  $('#ghSearch').addEventListener('input', e => {
    state.gh.query = e.target.value.trim();
    renderGhList();
  });
}

// 启动
(async function init() {
  bind();
  setGlobalStatus('', '就绪');
  // 尝试读取已有数据
  await loadAi();
  await loadGh();
})();
