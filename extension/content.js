// Local Grammar — content script.
// Watches text selections, shows a check button and a suggestion card, applies fixes.

(() => {
  if (window.__localGrammarLoaded) return;
  window.__localGrammarLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const MIN_CHARS = 3;

  let settings = { enabled: true, autoCheck: false };
  let host = null;
  let shadow = null;
  let triggerEl = null;
  let cardEl = null;
  let current = null; // captured selection
  let lastMouse = null;
  let debounceTimer = null;
  let requestSeq = 0;
  let lastAutoText = "";

  api.storage.local.get({ enabled: true, autoCheck: false }).then((s) => (settings = { ...settings, ...s }));
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
    if (!settings.enabled) hideAll();
  });

  // ---------- selection capture ----------

  const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", ""]);

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el.getAttribute("type") || "").toLowerCase());
  }

  function editableRootOf(el) {
    while (el && el.parentElement && el.parentElement.isContentEditable) el = el.parentElement;
    return el;
  }

  function captureSelection() {
    const active = deepActiveElement();
    if (isTextField(active)) {
      const start = active.selectionStart;
      const end = active.selectionEnd;
      if (start == null || start === end) return null;
      return { kind: "input", el: active, start, end, text: active.value.slice(start, end) };
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    if (!text.trim()) return null;
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (host && host.contains(el)) return null;
    const editable = Boolean(el && el.isContentEditable);
    return {
      kind: editable ? "editable" : "static",
      range: range.cloneRange(),
      root: editable ? editableRootOf(el) : null,
      text,
    };
  }

  function worthChecking(text) {
    const t = (text || "").trim();
    return t.length >= MIN_CHARS && /[a-z]/i.test(t);
  }

  // ---------- positioning ----------

  function anchorFor(capture) {
    const recentMouse = lastMouse && Date.now() - lastMouse.t < 2000 ? lastMouse : null;
    if (capture?.kind === "input") {
      if (recentMouse) return { x: recentMouse.x, bottom: recentMouse.y, top: recentMouse.y };
      const r = capture.el.getBoundingClientRect();
      return { x: r.left, bottom: r.bottom, top: r.top };
    }
    if (capture?.range) {
      const rects = [...capture.range.getClientRects()].filter((r) => r.width > 1);
      const last = rects.length ? rects[rects.length - 1] : capture.range.getBoundingClientRect();
      const box = capture.range.getBoundingClientRect();
      if (last.width || last.height) return { x: last.right, bottom: last.bottom, top: box.top };
    }
    if (recentMouse) return { x: recentMouse.x, bottom: recentMouse.y, top: recentMouse.y };
    return { x: window.innerWidth / 2 - 180, bottom: 60, top: 60 };
  }

  function place(el, anchor, { below = 8, alignLeft = 0 } = {}) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.min(Math.max(anchor.x - alignLeft, 8), vw - w - 8);
    let top = anchor.bottom + below;
    if (top + h > vh - 8 && anchor.top - h - below > 8) top = anchor.top - h - below;
    el.style.left = `${left + window.scrollX}px`;
    el.style.top = `${top + window.scrollY}px`;
  }

  // ---------- UI (shadow DOM) ----------

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .lg { --bg:#ffffff; --fg:#1f2328; --muted:#646c76; --line:#e3e6ea; --soft:#f5f7f9;
          --accent:#229666; --accent-fg:#ffffff; --del:#c62828; --del-bg:#fde7e7;
          --ins:#1b7a4c; --ins-bg:#dff5e8; --shadow:0 10px 30px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08);
          font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); }
    @media (prefers-color-scheme: dark) {
      .lg { --bg:#1e2227; --fg:#e7eaee; --muted:#9aa3ad; --line:#343a42; --soft:#262b31;
            --accent:#33b07d; --del:#ff8a80; --del-bg:#4a2326; --ins:#7ee2a8; --ins-bg:#1f3d2d;
            --shadow:0 10px 30px rgba(0,0,0,.5); }
    }
    .trigger { position:absolute; width:30px; height:30px; border-radius:50%; border:none; cursor:pointer;
               background:var(--accent); color:var(--accent-fg); box-shadow:var(--shadow);
               display:flex; align-items:center; justify-content:center; padding:0;
               animation: pop .12s ease-out; }
    .trigger:hover { filter: brightness(1.08); transform: scale(1.06); }
    .trigger svg { width:16px; height:16px; }
    .card { position:absolute; width:min(380px, calc(100vw - 16px)); background:var(--bg); border:1px solid var(--line);
            border-radius:12px; box-shadow:var(--shadow); overflow:hidden; animation: pop .12s ease-out; }
    .hdr { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); }
    .dot { width:18px; height:18px; border-radius:5px; background:var(--accent); color:var(--accent-fg);
           display:flex; align-items:center; justify-content:center; flex:none; }
    .dot svg { width:11px; height:11px; }
    .title { font-weight:600; }
    .model { color:var(--muted); font-size:12px; margin-left:auto; max-width:170px; overflow:hidden;
             text-overflow:ellipsis; white-space:nowrap; }
    .x { border:none; background:none; color:var(--muted); font-size:18px; line-height:1; cursor:pointer;
         padding:2px 4px; border-radius:6px; }
    .x:hover { background:var(--soft); color:var(--fg); }
    .body { padding:12px; max-height:min(340px, 50vh); overflow:auto; }
    .diff { white-space:pre-wrap; word-wrap:break-word; }
    del { color:var(--del); background:var(--del-bg); text-decoration:line-through; border-radius:3px; padding:0 1px; }
    ins { color:var(--ins); background:var(--ins-bg); text-decoration:none; border-radius:3px; padding:0 1px; font-weight:500; }
    .ok { display:flex; align-items:center; gap:8px; color:var(--ins); font-weight:500; }
    .err { color:var(--del); }
    .issues { list-style:none; margin:12px 0 0; padding:0; display:flex; flex-direction:column; gap:8px; }
    .issue { background:var(--soft); border-radius:8px; padding:8px 10px; font-size:13px; }
    .issue .chg { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px; }
    .issue .why { color:var(--muted); margin-top:2px; }
    .badge { font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; font-weight:600; color:var(--muted);
             border:1px solid var(--line); border-radius:999px; padding:0 6px; }
    .arrow { color:var(--muted); }
    .actions { display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--line); align-items:center; }
    .actions .meta { margin-left:auto; color:var(--muted); font-size:12px; }
    button.btn { font:inherit; font-size:13px; border-radius:8px; padding:5px 12px; cursor:pointer;
                 border:1px solid var(--line); background:var(--bg); color:var(--fg); }
    button.btn:hover { background:var(--soft); }
    button.btn.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-fg); font-weight:600; }
    button.btn.primary:hover { filter:brightness(1.08); }
    .loading { display:flex; align-items:center; gap:10px; color:var(--muted); }
    .spin { width:16px; height:16px; border-radius:50%; border:2px solid var(--line); border-top-color:var(--accent);
            animation: spin .7s linear infinite; flex:none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pop { from { opacity:0; transform: translateY(3px) scale(.98); } }
  `;

  function checkIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const attrs = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": "2.4",
                    "stroke-linecap": "round", "stroke-linejoin": "round" };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M3 8.5l3.2 3.2L13 4.8");
    svg.append(path);
    return svg;
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("local-grammar-ui");
    host.style.cssText = "all:initial; position:absolute; top:0; left:0; width:0; height:0; z-index:2147483647;";
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const wrap = document.createElement("div");
    wrap.className = "lg";
    shadow.append(style, wrap);
    // Keep focus and selection in the page when clicking our UI.
    shadow.addEventListener("mousedown", (e) => {
      if (!e.target.closest?.(".body")) e.preventDefault();
    });
    document.documentElement.appendChild(host);
  }

  function container() {
    ensureHost();
    return shadow.querySelector(".lg");
  }

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) if (c != null) el.append(c);
    return el;
  }

  function hideTrigger() {
    triggerEl?.remove();
    triggerEl = null;
  }

  function hideCard() {
    cardEl?.remove();
    cardEl = null;
    requestSeq++;
  }

  function hideAll() {
    hideTrigger();
    hideCard();
  }

  function showTrigger(capture) {
    hideTrigger();
    triggerEl = h("button", {
      class: "trigger",
      title: "Check grammar (Alt+Shift+G)",
      onclick: () => runCheck(capture),
    }, checkIcon());
    container().append(triggerEl);
    place(triggerEl, anchorFor(capture), { below: 6, alignLeft: -4 });
  }

  function cardShell(modelLabel) {
    const body = h("div", { class: "body" });
    const actions = h("div", { class: "actions" });
    const card = h(
      "div",
      { class: "card", role: "dialog", "aria-label": "Grammar suggestions" },
      h(
        "div",
        { class: "hdr" },
        h("span", { class: "dot" }, checkIcon()),
        h("span", { class: "title" }, "Local Grammar"),
        h("span", { class: "model" }, modelLabel || ""),
        h("button", { class: "x", title: "Close (Esc)", onclick: hideCard }, "×")
      ),
      body,
      actions
    );
    return { card, body, actions };
  }

  function mountCard(card, anchor) {
    cardEl?.remove();
    cardEl = card;
    container().append(card);
    place(card, anchor, { below: 10, alignLeft: 24 });
  }

  // ---------- diff ----------

  function tokenize(s) {
    return s.match(/\s+|[\p{L}\p{N}'’_-]+|[^\s\p{L}\p{N}]/gu) || [];
  }

  function wordDiff(a, b) {
    const x = tokenize(a);
    const y = tokenize(b);
    const n = x.length;
    const m = y.length;
    if (n * m > 4_000_000) return [{ op: "ins", text: b }];
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    const push = (op, text) => {
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += text;
      else out.push({ op, text });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) push("eq", x[i++]), j++;
      else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
      else push("ins", y[j++]);
    }
    while (i < n) push("del", x[i++]);
    while (j < m) push("ins", y[j++]);
    return out;
  }

  function renderDiff(a, b) {
    const el = h("div", { class: "diff" });
    for (const part of wordDiff(a, b)) {
      if (part.op === "eq") el.append(part.text);
      else el.append(h(part.op === "del" ? "del" : "ins", {}, part.text));
    }
    return el;
  }

  // ---------- check ----------

  async function runCheck(capture) {
    hideTrigger();
    if (!capture || !worthChecking(capture.text)) return;
    current = capture;
    const anchor = anchorFor(capture);
    const seq = ++requestSeq;

    const loading = cardShell("");
    loading.body.append(h("div", { class: "loading" }, h("span", { class: "spin" }), "Checking with your local model…"));
    loading.actions.remove();
    mountCard(loading.card, anchor);

    let response;
    try {
      response = await api.runtime.sendMessage({ type: "check", text: capture.text });
    } catch (err) {
      response = { ok: false, error: "Extension was reloaded — refresh this page and try again." };
    }
    if (seq !== requestSeq) return;

    if (!response?.ok) {
      const view = cardShell("");
      view.body.append(h("div", { class: "err" }, response?.error || "Something went wrong."));
      view.actions.append(h("button", { class: "btn", onclick: () => runCheck(capture) }, "Retry"));
      mountCard(view.card, anchor);
      return;
    }

    renderResult(capture, response.data, anchor);
  }

  function renderResult(capture, result, anchor) {
    const view = cardShell(result.model);
    const changed = result.corrected.trim() !== result.original.trim();

    if (!changed) {
      view.body.append(h("div", { class: "ok" }, checkIcon(), h("span", {}, "Looks good — no issues found.")));
    } else {
      view.body.append(renderDiff(result.original, result.corrected));
      if (result.issues.length) {
        const list = h("ul", { class: "issues" });
        for (const issue of result.issues) {
          list.append(
            h(
              "li",
              { class: "issue" },
              h(
                "div",
                { class: "chg" },
                h("span", { class: "badge" }, issue.type),
                h("del", {}, issue.original || "∅"),
                h("span", { class: "arrow" }, "→"),
                h("ins", {}, issue.suggestion || "(remove)")
              ),
              issue.explanation ? h("div", { class: "why" }, issue.explanation) : null
            )
          );
        }
        view.body.append(list);
      }
    }

    const canReplace = changed && (capture.kind === "input" || capture.kind === "editable");
    if (canReplace) {
      view.actions.append(
        h(
          "button",
          {
            class: "btn primary",
            onclick: () => {
              if (applyReplacement(capture, result.corrected)) hideCard();
              else flash(view.actions, "Couldn't replace — the text changed. Copy instead.");
            },
          },
          "Accept fix"
        )
      );
    }
    if (changed) {
      view.actions.append(
        h(
          "button",
          {
            class: canReplace ? "btn" : "btn primary",
            onclick: async (e) => {
              await copyText(result.corrected);
              e.target.textContent = "Copied";
            },
          },
          "Copy"
        )
      );
    }
    view.actions.append(h("button", { class: "btn", onclick: hideCard }, changed ? "Ignore" : "Close"));
    if (result.seconds) view.actions.append(h("span", { class: "meta" }, `${result.seconds.toFixed(1)}s`));
    mountCard(view.card, anchor);
  }

  function flash(actions, text) {
    actions.querySelector(".meta")?.remove();
    actions.append(h("span", { class: "meta err" }, text));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed; opacity:0;";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  // ---------- replace ----------

  function applyReplacement(capture, corrected) {
    const lead = capture.text.match(/^\s*/)[0];
    const trail = capture.text.match(/\s*$/)[0];
    const replacement = lead + corrected.trim() + trail;

    if (capture.kind === "input") {
      const el = capture.el;
      if (!el.isConnected) return false;
      let { start, end } = capture;
      if (el.value.slice(start, end) !== capture.text) {
        const idx = el.value.indexOf(capture.text);
        if (idx < 0) return false;
        start = idx;
        end = idx + capture.text.length;
      }
      el.focus();
      el.setSelectionRange(start, end);
      // execCommand keeps the page's undo history and fires the events frameworks listen to.
      const ok = document.execCommand("insertText", false, replacement);
      if (!ok || el.value.slice(start, start + replacement.length) !== replacement) {
        el.setRangeText(replacement, start, end, "end");
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      }
      return true;
    }

    if (capture.kind === "editable") {
      const { range, root } = capture;
      if (!root?.isConnected) return false;
      root.focus();
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand("insertText", false, replacement)) {
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
      }
      return true;
    }
    return false;
  }

  // ---------- events ----------

  function fromOurUI(e) {
    return host && e.composedPath().includes(host);
  }

  function scheduleSelectionCheck() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!settings.enabled) return;
      const capture = captureSelection();
      if (!capture || !worthChecking(capture.text)) {
        hideTrigger();
        lastAutoText = "";
        return;
      }
      if (settings.autoCheck) {
        if (capture.text === lastAutoText && cardEl) return;
        lastAutoText = capture.text;
        runCheck(capture);
      } else {
        showTrigger(capture);
      }
    }, 220);
  }

  document.addEventListener(
    "mouseup",
    (e) => {
      if (fromOurUI(e) || e.button !== 0) return;
      lastMouse = { x: e.clientX, y: e.clientY, t: Date.now() };
      scheduleSelectionCheck();
    },
    true
  );

  document.addEventListener(
    "keyup",
    (e) => {
      if (fromOurUI(e)) return;
      const selecting = e.shiftKey || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a");
      if (selecting) scheduleSelectionCheck();
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (fromOurUI(e)) return;
      hideTrigger();
      if (cardEl) hideCard();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && (cardEl || triggerEl)) hideAll();
    },
    true
  );

  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "check-selection") return;
    if (!settings.enabled) return;
    const capture = captureSelection() || (msg.text ? { kind: "static", text: msg.text, range: null } : null);
    if (capture) runCheck(capture);
  });
})();
