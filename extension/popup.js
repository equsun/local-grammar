// Local Grammar — settings popup.

const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { enabled: true, autoCheck: false, ollamaUrl: "http://localhost:11434", model: "", mode: "grammar" };
const $ = (id) => document.getElementById(id);

async function send(type, extra = {}) {
  const res = await api.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || "No response from the extension.");
  return res.data;
}

function setStatus(kind, text) {
  $("status").className = `status ${kind}`;
  $("status-text").textContent = text;
}

function formatSize(bytes) {
  if (!bytes) return "";
  return bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

let models = [];

function updateModelHint() {
  const m = models.find((x) => x.name === $("model").value);
  const hint = $("model-hint");
  if (!m) {
    hint.textContent = "";
    return;
  }
  hint.textContent = m.remote
    ? "☁︎ Ollama cloud model — your text is sent to ollama.com, not kept on this computer."
    : `Runs on this computer${m.params ? ` · ${m.params}` : ""}${m.size ? ` · ${formatSize(m.size)}` : ""}`;
}

async function loadModels() {
  const btn = $("refresh");
  btn.classList.add("spinning");
  btn.disabled = true;
  const select = $("model");
  try {
    const [version, list] = await Promise.all([send("version"), send("listModels")]);
    models = list;
    const { model } = await api.storage.local.get(DEFAULTS);
    select.replaceChildren();

    const local = list.filter((m) => !m.remote);
    const cloud = list.filter((m) => m.remote);
    for (const [label, group] of [["On this computer", local], ["Ollama cloud", cloud]]) {
      if (!group.length) continue;
      const og = document.createElement("optgroup");
      og.label = label;
      for (const m of group) og.append(new Option(m.name, m.name));
      select.append(og);
    }

    if (!list.length) {
      select.append(new Option("No models — run: ollama pull gemma3", ""));
      setStatus("bad", `Ollama ${version} is running, but no models are installed.`);
      return;
    }

    const chosen = list.some((m) => m.name === model) ? model : (local[0] || list[0]).name;
    select.value = chosen;
    if (chosen !== model) await api.storage.local.set({ model: chosen });
    setStatus("ok", `Connected · Ollama ${version} · ${list.length} model${list.length === 1 ? "" : "s"}`);
    updateModelHint();
  } catch (err) {
    const { model } = await api.storage.local.get(DEFAULTS);
    select.replaceChildren(new Option(model || "—", model));
    setStatus("bad", err.message);
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

function renderDiffInto(el, a, b) {
  // Simple word-level diff for the popup preview.
  const tok = (s) => s.match(/\s+|[\p{L}\p{N}'’_-]+|[^\s\p{L}\p{N}]/gu) || [];
  const x = tok(a), y = tok(b);
  const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0;
  const add = (tag, t) => {
    const n = document.createElement(tag);
    n.textContent = t;
    el.append(n);
  };
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) el.append(x[i++]), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) add("del", x[i++]);
    else add("ins", y[j++]);
  }
  while (i < x.length) add("del", x[i++]);
  while (j < y.length) add("ins", y[j++]);
}

async function runTest() {
  const out = $("test-out");
  const btn = $("test");
  btn.disabled = true;
  btn.textContent = "Checking…";
  out.hidden = false;
  out.className = "out";
  out.textContent = "Waiting for the model (the first run loads it into memory)…";
  try {
    const r = await send("check", { text: $("sample").value });
    out.replaceChildren();
    if (r.corrected.trim() === r.original.trim()) out.append("✓ No issues found.");
    else renderDiffInto(out, r.original, r.corrected);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${r.model} · ${r.seconds.toFixed(1)}s`;
    out.append(meta);
  } catch (err) {
    out.className = "out err";
    out.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Check";
  }
}

async function checkPermission() {
  if (!api.permissions?.contains) return;
  const granted = await api.permissions.contains({ origins: ["<all_urls>"] });
  $("perm").hidden = granted;
}

async function init() {
  const s = await api.storage.local.get(DEFAULTS);
  $("enabled").checked = s.enabled;
  $("autoCheck").checked = s.autoCheck;
  $("mode").value = s.mode;
  $("url").value = s.ollamaUrl;
  document.body.classList.toggle("off", !s.enabled);

  $("enabled").addEventListener("change", (e) => {
    api.storage.local.set({ enabled: e.target.checked });
    document.body.classList.toggle("off", !e.target.checked);
  });
  $("autoCheck").addEventListener("change", (e) => api.storage.local.set({ autoCheck: e.target.checked }));
  $("mode").addEventListener("change", (e) => api.storage.local.set({ mode: e.target.value }));
  $("model").addEventListener("change", (e) => {
    if (e.target.value) api.storage.local.set({ model: e.target.value });
    updateModelHint();
  });
  $("refresh").addEventListener("click", loadModels);
  $("save-url").addEventListener("click", async () => {
    const url = $("url").value.trim() || DEFAULTS.ollamaUrl;
    try {
      new URL(url);
    } catch {
      setStatus("bad", "That doesn't look like a URL.");
      return;
    }
    await api.storage.local.set({ ollamaUrl: url });
    loadModels();
  });
  $("test").addEventListener("click", runTest);
  $("grant").addEventListener("click", async () => {
    await api.permissions.request({ origins: ["<all_urls>"] });
    checkPermission();
  });

  checkPermission();
  loadModels();
}

init();
