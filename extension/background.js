// Local Grammar — background script (Firefox event page / Chrome service worker).
// Talks to Ollama, owns settings defaults, context menu and keyboard shortcut.

const api = globalThis.browser ?? globalThis.chrome;
const IS_FIREFOX = typeof api.runtime.getBrowserInfo === "function";

const DEFAULTS = {
  enabled: true,
  autoCheck: false,
  ollamaUrl: "http://localhost:11434",
  model: "",
  mode: "grammar", // "grammar" | "clarity"
};

const MAX_CHARS = 6000;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    corrected: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          suggestion: { type: "string" },
          explanation: { type: "string" },
          type: {
            type: "string",
            enum: ["grammar", "spelling", "punctuation", "word-choice", "style", "clarity"],
          },
        },
        required: ["original", "suggestion", "explanation", "type"],
      },
    },
  },
  required: ["corrected", "issues"],
};

const PROMPTS = {
  grammar:
    "You are a meticulous English proofreader. Correct grammar, spelling, punctuation, " +
    "capitalization and word-usage errors in the text inside <text> tags. Make the smallest " +
    "edits possible: keep the author's meaning, tone, wording, formatting and line breaks. " +
    "Do not rewrite sentences that are already correct and do not add new content.",
  clarity:
    "You are an expert English editor. Correct grammar, spelling, punctuation and word-usage " +
    "errors in the text inside <text> tags, and also make light edits that improve clarity " +
    "and flow. Keep the author's meaning, voice, formatting and line breaks. Do not add new content.",
};
const OUTPUT_RULES =
  " Respond only with JSON: \"corrected\" is the full corrected text (without the <text> tags); " +
  "\"issues\" lists each change with the exact \"original\" fragment, its \"suggestion\", a short " +
  "\"explanation\" and a \"type\". If the text has no problems, return it unchanged with an empty issues list.";

// ---------- settings ----------

async function getSettings() {
  return api.storage.local.get(DEFAULTS);
}

function baseUrl(url) {
  return (url || DEFAULTS.ollamaUrl).trim().replace(/\/+$/, "");
}

// ---------- Origin header ----------
// Ollama answers 403 to requests whose Origin is moz-extension:// or chrome-extension://
// unless OLLAMA_ORIGINS is set. Stripping the header from our own requests avoids that.

if (IS_FIREFOX && api.webRequest?.onBeforeSendHeaders) {
  const ownOrigin = api.runtime.getURL("");
  api.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const from = details.originUrl || details.documentUrl || "";
      if (!from.startsWith(ownOrigin)) return {};
      return { requestHeaders: details.requestHeaders.filter((h) => h.name.toLowerCase() !== "origin") };
    },
    { urls: ["*://*/api/*"] },
    ["blocking", "requestHeaders"]
  );
}

async function syncChromeOriginRule() {
  if (IS_FIREFOX || !api.declarativeNetRequest) return;
  const { ollamaUrl } = await getSettings();
  let host;
  try {
    host = new URL(baseUrl(ollamaUrl)).hostname;
  } catch {
    return;
  }
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: {
          requestDomains: [host],
          initiatorDomains: [api.runtime.id],
          resourceTypes: ["xmlhttprequest", "other"],
        },
      },
    ],
  });
}

// ---------- Ollama ----------

async function ollama(path, body) {
  const { ollamaUrl } = await getSettings();
  const url = baseUrl(ollamaUrl) + path;
  let res;
  try {
    res = await fetch(
      url,
      body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : undefined
    );
  } catch {
    throw new Error(`Can't reach Ollama at ${baseUrl(ollamaUrl)}. Is it running? (start the Ollama app or run "ollama serve")`);
  }
  if (res.status === 403) {
    throw new Error(
      'Ollama refused the request (403). Set OLLAMA_ORIGINS="moz-extension://*,chrome-extension://*" and restart Ollama.'
    );
  }
  if (!res.ok) {
    let msg = await res.text();
    try {
      msg = JSON.parse(msg).error || msg;
    } catch {}
    const err = new Error(`Ollama error ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listModels() {
  const data = await ollama("/api/tags");
  return (data.models || [])
    .filter((m) => {
      const caps = m.capabilities || [];
      return !(caps.includes("embedding") && !caps.includes("completion"));
    })
    .map((m) => ({
      name: m.name,
      remote: Boolean(m.remote_host),
      size: m.size,
      params: m.details?.parameter_size || "",
      thinking: (m.capabilities || []).includes("thinking"),
    }));
}

async function getVersion() {
  const data = await ollama("/api/version");
  return data.version;
}

async function resolveModel() {
  const settings = await getSettings();
  if (settings.model) return settings.model;
  const models = await listModels();
  const pick = models.find((m) => !m.remote) || models[0];
  if (!pick) throw new Error('No Ollama models found. Download one, e.g. "ollama pull gemma3".');
  await api.storage.local.set({ model: pick.name });
  return pick.name;
}

function cleanCorrected(s) {
  return String(s ?? "")
    .replace(/^\s*<text>\s*/i, "")
    .replace(/\s*<\/text>\s*$/i, "");
}

async function checkGrammar(text) {
  text = String(text ?? "").trim();
  if (!text) throw new Error("Nothing selected.");
  if (text.length > MAX_CHARS) throw new Error(`Selection is too long (${text.length} chars). Select under ${MAX_CHARS} characters.`);

  const { mode } = await getSettings();
  const model = await resolveModel();
  const body = {
    model,
    stream: false,
    think: false,
    keep_alive: "15m",
    format: RESULT_SCHEMA,
    options: { temperature: 0 },
    messages: [
      { role: "system", content: (PROMPTS[mode] || PROMPTS.grammar) + OUTPUT_RULES },
      { role: "user", content: `<text>\n${text}\n</text>` },
    ],
  };

  let data;
  try {
    data = await ollama("/api/chat", body);
  } catch (err) {
    // Some models reject the think flag; retry without it.
    if (err.status === 400 && /think/i.test(err.message)) {
      delete body.think;
      data = await ollama("/api/chat", body);
    } else {
      throw err;
    }
  }

  const content = (data.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("The model returned an unexpected answer. Try another model.");
    parsed = JSON.parse(match[0]);
  }

  const corrected = cleanCorrected(parsed.corrected) || text;
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .filter((i) => i && typeof i.original === "string" && typeof i.suggestion === "string")
    .filter((i) => i.original.trim() !== i.suggestion.trim())
    .map((i) => ({
      original: i.original,
      suggestion: i.suggestion,
      explanation: String(i.explanation || ""),
      type: String(i.type || "grammar"),
    }));

  return { original: text, corrected, issues, model, seconds: (data.total_duration || 0) / 1e9 };
}

// ---------- badge ----------

async function updateBadge() {
  const { enabled } = await getSettings();
  await api.action.setBadgeText({ text: enabled ? "" : "off" });
  await api.action.setBadgeBackgroundColor({ color: "#6b7280" });
}

// ---------- context menu & shortcut ----------

function setupMenus() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: "check-grammar",
      title: "Check grammar with Local Grammar",
      contexts: ["selection"],
    });
  });
}

api.runtime.onInstalled.addListener(() => {
  setupMenus();
  updateBadge();
  syncChromeOriginRule();
});
api.runtime.onStartup.addListener(() => {
  setupMenus();
  updateBadge();
  syncChromeOriginRule();
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "check-grammar" || !tab?.id) return;
  api.tabs
    .sendMessage(tab.id, { type: "check-selection", text: info.selectionText }, { frameId: info.frameId ?? 0 })
    .catch(() => {});
});

api.commands.onCommand.addListener(async (command) => {
  if (command !== "check-grammar") return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) api.tabs.sendMessage(tab.id, { type: "check-selection" }).catch(() => {});
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.enabled) updateBadge();
  if (changes.ollamaUrl) syncChromeOriginRule();
});

// ---------- messages from content script & popup ----------

const handlers = {
  check: (msg) => checkGrammar(msg.text),
  listModels: () => listModels(),
  version: () => getVersion(),
};

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err?.message || String(err) })
    );
  return true;
});
