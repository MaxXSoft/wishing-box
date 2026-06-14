(function () {
  'use strict';

  // ── Config (localStorage) ──

  const CONFIG_KEY = 'wishing-box-config';

  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }

  function getConfig() {
    const cfg = loadConfig();
    return {
      baseUrl: (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: cfg.apiKey || '',
      model: cfg.model || 'gpt-4o',
    };
  }

  // ── DOM refs ──

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    settingsBtn: $('#settings-btn'),
    settingsModal: $('#settings-modal'),
    cfgBaseUrl: $('#cfg-base-url'),
    cfgApiKey: $('#cfg-api-key'),
    cfgModel: $('#cfg-model'),
    settingsSave: $('#settings-save'),
    settingsCancel: $('#settings-cancel'),

    screenHome: $('#screen-home'),
    searchInput: $('#search-input'),
    searchBtn: $('#search-btn'),

    screenCandidates: $('#screen-candidates'),
    searchInputTop: $('#search-input-top'),
    searchBtnTop: $('#search-btn-top'),
    candidatesGrid: $('#candidates-grid'),
    refreshBtn: $('#refresh-btn'),

    screenApp: $('#screen-app'),
    backBtn: $('#back-btn'),
    appTitle: $('#app-title'),
    appIframe: $('#app-iframe'),
    appLoading: $('#app-loading'),
    appInteracting: $('#app-interacting'),

    errorToast: $('#error-toast'),
  };

  // ── State ──

  let state = {
    screen: 'home',
    query: '',
    candidates: [],
    currentApp: null,
    currentHtml: '',
    loading: false,
  };

  // ── Screens ──

  function showScreen(name) {
    state.screen = name;
    els.screenHome.classList.toggle('hidden', name !== 'home');
    els.screenCandidates.classList.toggle('hidden', name !== 'candidates');
    els.screenApp.classList.toggle('hidden', name !== 'app');
  }

  // ── Settings Modal ──

  function openSettings() {
    const cfg = loadConfig();
    els.cfgBaseUrl.value = cfg.baseUrl || '';
    els.cfgApiKey.value = cfg.apiKey || '';
    els.cfgModel.value = cfg.model || '';
    els.settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    els.settingsModal.classList.add('hidden');
  }

  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsCancel.addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettings();
  });

  els.settingsSave.addEventListener('click', () => {
    saveConfig({
      baseUrl: els.cfgBaseUrl.value.trim(),
      apiKey: els.cfgApiKey.value.trim(),
      model: els.cfgModel.value.trim(),
    });
    closeSettings();
  });

  // ── Error Toast ──

  let toastTimer = null;

  function showError(msg) {
    els.errorToast.textContent = msg;
    els.errorToast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.errorToast.classList.add('hidden'), 5000);
  }

  // ── LLM API ──

  async function callLLM(messages) {
    const cfg = getConfig();
    if (!cfg.baseUrl) {
      openSettings();
      throw new Error('请先配置 API Base URL');
    }

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    }

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 1,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API 错误 (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  // ── Prompts ──

  const SYSTEM_CANDIDATES = `You are "许愿盒" (Wishing Box), a magical app store powered by pure imagination and LLM hallucinations.

Given a user's description of what they want, generate exactly 10 candidate apps. Each candidate should take a DIFFERENT creative angle — some practical, some humorous, some absurd, some wholesome. Be imaginative and fun.

Return a JSON array of exactly 10 objects. Each object has:
- "icon": a single emoji representing the app
- "name": a creative, catchy app name
- "description": a one-line fun description of what the app does

Rules:
- Respond with ONLY the JSON array. No markdown fences, no extra text.
- Use the same language as the user's input for name and description.`;

  function buildAppGenPrompt(app) {
    return `Generate a complete, self-contained HTML document for the following application:

App name: ${app.icon} ${app.name}
App description: ${app.description}

Rules:
1. Create a visually appealing, realistic-looking, and detailed application UI.
2. ALL interactive elements (buttons, inputs, textareas, selects, links, checkboxes, radio buttons) MUST have unique "id" attributes.
3. Do NOT include any <script> tags — the app contains no real code. All interactivity is powered externally.
4. Use a <style> tag for styling. Make it look polished and modern.
5. Fill in realistic-looking placeholder content — this runs on imagination, not real data. Be creative!
6. The HTML must be fully self-contained. No external stylesheets or scripts (inline emoji/unicode is fine).
7. Use the same language as the app name/description for UI text.

Respond with ONLY the raw HTML document (starting with <!DOCTYPE html> or <html>). No markdown fences, no explanations.`;
  }

  function buildInteractionPrompt(html, clickedId, formValues) {
    return `You are running an interactive HTML application powered by pure imagination.

Here is the current HTML state of the app:
\`\`\`
${html}
\`\`\`

The user just clicked the element with id="${clickedId}".

Current form/input values on the page:
${JSON.stringify(formValues, null, 2)}

Generate the complete updated HTML document reflecting the result of this interaction. The app should respond naturally and creatively to the user's action. Since this app runs on imagination, you can make up any response — be fun and creative!

Rules:
1. ALL interactive elements MUST keep unique "id" attributes.
2. Do NOT include any <script> tags.
3. Maintain the same overall style and layout, but update content as appropriate.
4. Respond with ONLY the raw HTML document. No markdown fences, no explanations.`;
  }

  // ── Flow 1: Generate Candidates ──

  function setSearchLoading(loading) {
    state.loading = loading;
    const btns = [els.searchBtn, els.searchBtnTop, els.refreshBtn];
    btns.forEach((btn) => {
      btn.disabled = loading;
      const textEl = btn.querySelector('.search-btn-text, .refresh-btn-text');
      const spinnerEl = btn.querySelector('.spinner');
      if (textEl) textEl.classList.toggle('hidden', loading);
      if (spinnerEl) spinnerEl.classList.toggle('hidden', !loading);
    });
  }

  async function generateCandidates(query) {
    if (state.loading || !query.trim()) return;
    state.query = query.trim();

    els.searchInput.value = state.query;
    els.searchInputTop.value = state.query;

    setSearchLoading(true);
    try {
      const raw = await callLLM([
        { role: 'system', content: SYSTEM_CANDIDATES },
        { role: 'user', content: state.query },
      ]);

      const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
      const candidates = JSON.parse(cleaned);

      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('LLM 返回了无效的候选列表');
      }

      state.candidates = candidates;
      renderCandidates();
      showScreen('candidates');
    } catch (err) {
      showError(err.message);
    } finally {
      setSearchLoading(false);
    }
  }

  function renderCandidates() {
    els.candidatesGrid.innerHTML = '';
    state.candidates.forEach((app, i) => {
      const card = document.createElement('div');
      card.className = 'candidate-card';
      card.innerHTML = `
        <span class="candidate-icon">${app.icon || '✨'}</span>
        <span class="candidate-name">${escapeHtml(app.name)}</span>
        <span class="candidate-desc">${escapeHtml(app.description)}</span>
      `;
      card.addEventListener('click', () => openApp(app));
      els.candidatesGrid.appendChild(card);
    });
  }

  // ── Flow 2: Generate App HTML ──

  async function openApp(app) {
    state.currentApp = app;
    els.appTitle.textContent = `${app.icon} ${app.name}`;
    showScreen('app');

    els.appLoading.classList.remove('hidden');
    els.appIframe.srcdoc = '';

    try {
      const html = await callLLM([
        { role: 'system', content: buildAppGenPrompt(app) },
        { role: 'user', content: `请生成这个应用：${app.name} — ${app.description}` },
      ]);

      state.currentHtml = stripScripts(html);
      renderAppHtml();
    } catch (err) {
      showError(err.message);
    } finally {
      els.appLoading.classList.add('hidden');
    }
  }

  function renderAppHtml() {
    els.appIframe.srcdoc = state.currentHtml;
    els.appIframe.onload = () => attachIframeListeners();
  }

  // ── Flow 3: Handle Interaction ──

  function attachIframeListeners() {
    const doc = els.appIframe.contentDocument;
    if (!doc) return;

    doc.addEventListener('click', (e) => {
      const target = findActionable(e.target);
      if (!target || !target.id) return;

      e.preventDefault();
      e.stopPropagation();
      handleInteraction(target.id, doc);
    });

    doc.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      const id = (submitBtn && submitBtn.id) || form.id;
      if (id) handleInteraction(id, doc);
    });
  }

  const ACTIONABLE = ['BUTTON', 'A'];
  const ACTIONABLE_INPUT_TYPES = ['button', 'submit', 'reset'];

  function findActionable(el) {
    let cur = el;
    while (cur && cur !== cur.ownerDocument.body) {
      if (ACTIONABLE.includes(cur.tagName)) return cur;
      if (cur.tagName === 'INPUT' && ACTIONABLE_INPUT_TYPES.includes(cur.type)) return cur;
      if (cur.getAttribute && cur.getAttribute('role') === 'button') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function collectFormValues(doc) {
    const values = {};
    doc.querySelectorAll('input, textarea, select').forEach((el) => {
      if (!el.id) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        values[el.id] = el.checked;
      } else {
        values[el.id] = el.value;
      }
    });
    return values;
  }

  async function handleInteraction(clickedId, doc) {
    if (state.loading) return;
    state.loading = true;
    els.appInteracting.classList.remove('hidden');

    const formValues = collectFormValues(doc);

    try {
      const html = await callLLM([
        {
          role: 'system',
          content: buildInteractionPrompt(state.currentHtml, clickedId, formValues),
        },
        {
          role: 'user',
          content: `用户点击了 id="${clickedId}"`,
        },
      ]);

      state.currentHtml = stripScripts(html);
      renderAppHtml();
    } catch (err) {
      showError(err.message);
    } finally {
      state.loading = false;
      els.appInteracting.classList.add('hidden');
    }
  }

  // ── Utilities ──

  function stripScripts(html) {
    return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ── Event Bindings ──

  function onSearch(inputEl) {
    generateCandidates(inputEl.value);
  }

  els.searchBtn.addEventListener('click', () => onSearch(els.searchInput));
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSearch(els.searchInput);
  });

  els.searchBtnTop.addEventListener('click', () => onSearch(els.searchInputTop));
  els.searchInputTop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSearch(els.searchInputTop);
  });

  els.refreshBtn.addEventListener('click', () => generateCandidates(state.query));

  els.backBtn.addEventListener('click', () => {
    els.appIframe.srcdoc = '';
    state.currentHtml = '';
    state.currentApp = null;
    showScreen('candidates');
  });
})();
