// The Codex — client-side app
(() => {
  'use strict';

  const state = {
    all: [],
    categories: [],
    filter: 'All',
    query: '',
    visible: [],
    activeIndex: -1,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const grid = $('#grid');
  const empty = $('#empty');
  const search = $('#search');
  const resultCount = $('#result-count');
  const filterBar = $('#category-filters');
  const themeBtn = $('#theme-btn');
  const randomBtn = $('#random-btn');
  const featured = $('#featured');
  const modal = $('#modal');
  const modalContent = $('#modal-content');
  const modalClose = $('#modal-close');

  /* ---------- theme ---------- */
  const setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('codex.theme', t); } catch {}
    themeBtn.textContent = t === 'dark' ? '☀' : '◐';
  };
  const initTheme = () => {
    let t;
    try { t = localStorage.getItem('codex.theme'); } catch {}
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(t);
  };
  themeBtn.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  /* ---------- data load ---------- */
  async function load() {
    const res = await fetch('data/principles.json');
    const data = await res.json();
    state.all = data.entries.map((e, i) => ({ ...e, _i: i }));
    state.categories = ['All', ...data.categories];
    renderFilters();
    renderFeatured();
    apply();
  }

  /* ---------- filters ---------- */
  function renderFilters() {
    filterBar.innerHTML = state.categories.map(c => {
      const count = c === 'All' ? state.all.length : state.all.filter(e => e.category === c).length;
      return `<button class="chip" role="tab" aria-pressed="${c === state.filter}" data-cat="${escapeAttr(c)}">${escapeHtml(c)} <span style="opacity:.55">${count}</span></button>`;
    }).join('');
  }
  filterBar.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.filter = btn.dataset.cat;
    $$('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.cat === state.filter));
    apply();
  });

  /* ---------- search & filter ---------- */
  function apply() {
    const q = state.query.trim().toLowerCase();
    state.visible = state.all.filter(e => {
      if (state.filter !== 'All' && e.category !== state.filter) return false;
      if (!q) return true;
      const blob = (e.name + ' ' + e.oneLiner + ' ' + e.description + ' ' + e.tags.join(' ') + ' ' + (e.origin || '')).toLowerCase();
      return blob.includes(q);
    });
    resultCount.textContent = state.visible.length === state.all.length
      ? `${state.all.length}`
      : `${state.visible.length}/${state.all.length}`;
    render();
  }

  search.addEventListener('input', () => {
    state.query = search.value;
    apply();
  });

  /* ---------- render ---------- */
  function render() {
    if (!state.visible.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const q = state.query.trim().toLowerCase();
    grid.innerHTML = state.visible.map((e, idx) => `
      <button class="card" data-idx="${idx}" aria-label="${escapeAttr(e.name)}">
        <span class="card-cat">${escapeHtml(e.category)}</span>
        <h3 class="card-name">${highlight(e.name, q)}</h3>
        <p class="card-oneliner">${highlight(e.oneLiner, q)}</p>
        <div class="card-tags">${e.tags.slice(0,3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      </button>
    `).join('');
  }

  grid.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    openModal(parseInt(card.dataset.idx, 10));
  });

  /* ---------- modal ---------- */
  function openModal(idx) {
    if (idx < 0 || idx >= state.visible.length) return;
    state.activeIndex = idx;
    const e = state.visible[idx];
    modalContent.innerHTML = `
      <div class="m-cat">${escapeHtml(e.category)}</div>
      <h2>${escapeHtml(e.name)}</h2>
      <p class="m-oneliner">${escapeHtml(e.oneLiner)}</p>
      <div class="m-section"><h3>What it is</h3><p>${escapeHtml(e.description)}</p></div>
      <div class="m-section"><h3>Example</h3><p>${escapeHtml(e.example)}</p></div>
      <div class="m-section"><h3>How to apply</h3><p>${escapeHtml(e.howToApply)}</p></div>
      <div class="m-section"><h3>Pitfalls &amp; nuance</h3><p>${escapeHtml(e.pitfalls)}</p></div>
      <p class="m-origin">${escapeHtml(e.origin)}</p>
      <div class="m-tags">${e.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>
      <div class="m-nav">
        <button data-nav="prev" ${idx === 0 ? 'disabled' : ''}>← Previous</button>
        <button data-nav="next" ${idx === state.visible.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    `;
    if (!modal.open) modal.showModal();
    modalContent.scrollTop = 0;
  }

  modalContent.addEventListener('click', e => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'prev') openModal(state.activeIndex - 1);
    else openModal(state.activeIndex + 1);
  });
  modalClose.addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => {
    const r = modalContent.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close();
  });

  /* ---------- random / featured ---------- */
  function renderFeatured() {
    if (!state.all.length) return;
    // deterministic pick by date so it's stable for the day
    const seed = (() => {
      const d = new Date();
      return d.getFullYear() * 1000 + d.getMonth() * 50 + d.getDate();
    })();
    const e = state.all[seed % state.all.length];
    featured.hidden = false;
    $('#featured-name').textContent = e.name;
    $('#featured-oneliner').textContent = e.oneLiner;
    featured.querySelector('[data-action="open-featured"]').onclick = () => {
      // ensure visible in current filter
      state.filter = 'All';
      state.query = '';
      search.value = '';
      $$('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.cat === 'All'));
      apply();
      const visIdx = state.visible.findIndex(v => v._i === e._i);
      if (visIdx >= 0) openModal(visIdx);
    };
  }

  randomBtn.addEventListener('click', () => {
    if (!state.visible.length) return;
    openModal(Math.floor(Math.random() * state.visible.length));
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') { e.target.blur(); }
      return;
    }
    if (modal.open) {
      if (e.key === 'ArrowLeft' && state.activeIndex > 0) { e.preventDefault(); openModal(state.activeIndex - 1); }
      else if (e.key === 'ArrowRight' && state.activeIndex < state.visible.length - 1) { e.preventDefault(); openModal(state.activeIndex + 1); }
      return;
    }
    if (e.key === '/') { e.preventDefault(); search.focus(); search.select(); }
    else if (e.key.toLowerCase() === 'r') { randomBtn.click(); }
    else if (e.key.toLowerCase() === 't') { themeBtn.click(); }
  });

  /* ---------- helpers ---------- */
  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s = '') { return escapeHtml(s); }
  function highlight(text, q) {
    if (!q) return escapeHtml(text);
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
  }

  /* ---------- bootstrap ---------- */
  initTheme();
  load().catch(err => {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--ink-mute)">
      Failed to load principles. If you opened this file directly (file://), serve it via a local web server:<br>
      <code style="font-family:var(--mono)">python3 -m http.server</code> then visit <code>http://localhost:8000</code>.
      <br><br><small>${escapeHtml(err.message)}</small>
    </div>`;
  });
})();
