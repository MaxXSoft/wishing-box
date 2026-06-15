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
      extraParams: cfg.extraParams || {},
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
    cfgExtraParams: $('#cfg-extra-params'),
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
    conversation: [],
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
    els.cfgExtraParams.value = cfg.extraParams ? JSON.stringify(cfg.extraParams, null, 2) : '';
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
    const extraRaw = els.cfgExtraParams.value.trim();
    let extraParams = {};
    if (extraRaw) {
      try {
        extraParams = JSON.parse(extraRaw);
        if (typeof extraParams !== 'object' || extraParams === null || Array.isArray(extraParams)) {
          throw new Error('额外参数必须是一个 JSON 对象');
        }
      } catch (err) {
        showError('额外参数 JSON 格式错误: ' + err.message);
        return;
      }
    }
    saveConfig({
      baseUrl: els.cfgBaseUrl.value.trim(),
      apiKey: els.cfgApiKey.value.trim(),
      model: els.cfgModel.value.trim(),
      extraParams: extraRaw ? extraParams : undefined,
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
        ...cfg.extraParams,
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

IMPORTANT: ALL output (name, description) MUST be in the SAME language as the user's input. If the user writes in Chinese, respond entirely in Chinese. If in English, respond in English. Never mix languages.

Given a user's description of what they want, generate exactly 10 candidate apps. Each candidate should take a DIFFERENT creative angle — some practical, some humorous, some absurd, some wholesome. Be imaginative and fun.

Return a JSON array of exactly 10 objects. Each object has:
- "icon": a single emoji representing the app
- "name": a creative, catchy app name (MUST match user's language)
- "description": a one-line fun description of what the app does (MUST match user's language)

Respond with ONLY the JSON array. No markdown fences, no extra text.`;

  const SYSTEM_APP = `You are the runtime engine of "许愿盒" (Wishing Box), a system that generates and runs interactive HTML applications powered entirely by LLM imagination. You will first design a detailed specification for an app, then generate its HTML, and then handle user interactions by producing diffs to update the HTML.

General rules that apply to ALL your HTML output:
1. ALL interactive elements (buttons, inputs, textareas, selects, links, checkboxes, radio buttons) MUST have unique "id" attributes.
2. Do NOT include any <script> tags — the app contains no real code.
3. Use a <style> tag for styling. Make it look polished and modern.
4. The HTML must be self-contained. No external stylesheets or scripts (inline emoji/unicode is fine).
5. Use the same language as the app name/description for all UI text.
6. Fill in realistic-looking, creative placeholder content — this runs on imagination, not real data.`;

  function buildSpecPrompt(app) {
    return `Please design a detailed specification for the following app:

App name: ${app.icon} ${app.name}
App description: ${app.description}

Describe in detail:
1. What functional modules/sections the app has
2. The layout — header, sidebar, main content area, footer, etc.
3. What specific content each section displays (be creative and detailed — make up realistic data)
4. What interactive elements exist (buttons, inputs, dropdowns, etc.) and what each one does
5. The visual style — colors, fonts, overall aesthetic

Write a detailed specification in plain text (a few hundred words). Use the same language as the app name. Do NOT output any HTML yet.`;
  }

  function buildHtmlPrompt() {
    return `Now generate the complete HTML document based on the specification above.

The HTML should be rich, detailed, and visually polished — include all the content, sections, and interactive elements described in the spec. Make it look like a real application, not a skeleton.

Respond with ONLY the raw HTML (starting with <!DOCTYPE html> or <html>). No markdown fences, no explanations.`;
  }

  function buildInteractionPrompt(html, clickedId, formValues) {
    return `The user interacted with the app. Here is the current HTML (ground truth):

\`\`\`html
${html}
\`\`\`

The user clicked the element with id="${clickedId}".

Current form/input values:
${JSON.stringify(formValues, null, 2)}

Respond with a JSON array of find-and-replace operations to update the HTML. Each operation is an object with "find" (exact string to find in the HTML) and "replace" (string to replace it with). Be creative and natural in how the app responds!

Example format:
[
  {"find": "<span id=\\"score\\">0</span>", "replace": "<span id=\\"score\\">1</span>"},
  {"find": "<p id=\\"msg\\">waiting</p>", "replace": "<p id=\\"msg\\">done!</p>"}
]

Rules:
- The "find" strings MUST exactly match substrings in the current HTML above.
- Keep all interactive elements' id attributes.
- Do NOT add any <script> tags.
- Respond with ONLY the JSON array. No markdown fences, no explanations.`;
  }

  function buildFallbackPrompt(html, clickedId, formValues) {
    return `The user interacted with the app. Here is the current HTML:

\`\`\`html
${html}
\`\`\`

The user clicked the element with id="${clickedId}".

Current form/input values:
${JSON.stringify(formValues, null, 2)}

Generate the complete updated HTML reflecting the result of this interaction. Be creative and natural.

Rules:
1. ALL interactive elements MUST keep unique "id" attributes.
2. Do NOT include any <script> tags.
3. Maintain the same overall style and layout, but update content as appropriate.
4. Respond with ONLY the raw HTML. No markdown fences, no explanations.`;
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

  // ── Flow 2: Generate App HTML (two-step: spec → HTML) ──

  async function openApp(app) {
    state.currentApp = app;
    state.conversation = [];
    els.appTitle.textContent = `${app.icon} ${app.name}`;
    showScreen('app');

    els.appLoading.classList.remove('hidden');
    els.appIframe.srcdoc = '';

    try {
      const messages = [{ role: 'system', content: SYSTEM_APP }];

      const specUserMsg = { role: 'user', content: buildSpecPrompt(app) };
      messages.push(specUserMsg);
      const spec = await callLLM(messages);
      const specAssistantMsg = { role: 'assistant', content: spec };
      messages.push(specAssistantMsg);

      const htmlUserMsg = { role: 'user', content: buildHtmlPrompt() };
      messages.push(htmlUserMsg);
      const html = await callLLM(messages);
      const htmlAssistantMsg = { role: 'assistant', content: html };
      messages.push(htmlAssistantMsg);

      state.currentHtml = stripScripts(html);
      state.conversation = messages;
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

  function applyDiffs(html, diffs) {
    let result = html;
    for (const { find, replace } of diffs) {
      if (!result.includes(find)) {
        throw new Error(`Diff 匹配失败: 找不到 "${find.slice(0, 60)}..."`);
      }
      result = result.replace(find, replace);
    }
    return result;
  }

  function parseDiffs(raw) {
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const diffs = JSON.parse(cleaned);
    if (!Array.isArray(diffs)) throw new Error('diff 不是数组');
    return diffs;
  }

  async function handleInteraction(clickedId, doc) {
    if (state.loading) return;
    state.loading = true;
    els.appInteracting.classList.remove('hidden');

    const formValues = collectFormValues(doc);

    try {
      const userMsg = {
        role: 'user',
        content: buildInteractionPrompt(state.currentHtml, clickedId, formValues),
      };
      state.conversation.push(userMsg);

      const raw = await callLLM(state.conversation);
      state.conversation.push({ role: 'assistant', content: raw });

      const diffs = parseDiffs(raw);
      state.currentHtml = stripScripts(applyDiffs(state.currentHtml, diffs));
      renderAppHtml();
    } catch (err) {
      console.warn('Diff 失败，尝试 fallback:', err.message);
      try {
        await handleInteractionFallback(clickedId, formValues);
      } catch (fallbackErr) {
        showError(fallbackErr.message);
      }
    } finally {
      state.loading = false;
      els.appInteracting.classList.add('hidden');
    }
  }

  async function handleInteractionFallback(clickedId, formValues) {
    const userMsg = {
      role: 'user',
      content: buildFallbackPrompt(state.currentHtml, clickedId, formValues),
    };
    state.conversation.push(userMsg);

    const html = await callLLM(state.conversation);
    state.conversation.push({ role: 'assistant', content: html });

    state.currentHtml = stripScripts(html);
    renderAppHtml();
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
    state.conversation = [];
    showScreen('candidates');
  });
})();
