# Local Grammar

A free, private, Grammarly-style grammar checker for your browser. Highlight any English text and get corrections from an AI model that runs **on your own computer** through [Ollama](https://ollama.com). You don't need an account, an API key or a subscription.

- ✓ Fixes grammar, spelling, punctuation and word choice, and explains each fix
- ✓ Shows changes in red and green and applies them with one click in text boxes and editors
- ✓ Lets you switch between any models you have installed in Ollama
- ✓ Works in Firefox, Chrome, Edge and Brave

---

## Requirements

| What | Details |
|---|---|
| **Ollama** | Free app that runs AI models locally. Download it from [ollama.com/download](https://ollama.com/download) (macOS, Windows, Linux). |
| **At least one model** | Any chat model works. See [Choosing a model](#choosing-a-model). |
| **A browser** | Firefox 140+, or Chrome / Edge / Brave 110+ (or another Chromium browser). |
| **Hardware** | About 4–8 GB of free RAM for a small model. A GPU or Apple Silicon makes it faster but isn't required. |

---

## Quick start

### 1. Install Ollama and download a model

Install Ollama from [ollama.com/download](https://ollama.com/download) and start it. Then open a terminal and download a model:

```bash
ollama pull gemma3:4b
```

Check that Ollama is running:

```bash
curl http://localhost:11434/api/version
```

You should see something like `{"version":"0.x.x"}`.

### 2. Install the extension

#### Firefox

**Signed version (recommended):** download `local-grammar-firefox-signed-*.xpi` from the [Releases](../../releases) page, then drag it into a Firefox window and click **Add**. It stays installed after Firefox restarts.

**From source (temporary):** clone this repo, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and select `extension/manifest.json`. Firefox removes it when it restarts.

#### Chrome, Edge, Brave

1. Download `local-grammar-chrome-edge-*.zip` from the [Releases](../../releases) page and unzip it. Or clone this repo and run `./build.sh`, then use the `dist/chrome` folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder (or `dist/chrome`).

Keep that folder, because the browser loads the extension from it.

### 3. Choose a model

Click the Local Grammar icon in the toolbar. If it's hidden, click the puzzle-piece icon and pin it. The status line should say **Connected**. Pick a model from the list, then click **Check** in the *Try it* box to test it.

---

## How to use it

1. **Highlight** text on any web page.
2. Click the green **✓** button that appears next to it. You can also:
   - press **Alt+Shift+G**, or
   - right-click and choose **Check grammar with Local Grammar**.
3. A card shows the corrected text with changes marked, and a short explanation for each fix.
   - **Accept fix** puts the corrected text in place. This works in text boxes, textareas and rich editors such as email composers.
   - **Copy** copies the corrected text to the clipboard.
   - **Ignore** (or Esc) closes the card.

The first check after starting Ollama takes longer while the model loads. After that, checks usually take a few seconds.

## Settings

Click the toolbar icon to open the settings.

| Setting | What it does |
|---|---|
| **On/off switch** | Turns the extension on or off. When it's off, the toolbar icon shows an "off" badge. |
| **Model** | Lists every model installed in Ollama, split into *On this computer* and *Ollama cloud*. Your choice is used right away. ↻ reloads the list after you `ollama pull` a new model. |
| **Corrections** | *Grammar, spelling & punctuation* makes the smallest fixes possible. *Also improve clarity & flow* also makes light edits to wording. |
| **Check as soon as I select** | Checks the text as soon as you select it, with no ✓ click. |
| **Advanced → Ollama URL** | Defaults to `http://localhost:11434`. Change it if Ollama runs on another port or machine. |

## Choosing a model

Larger models catch more errors but are slower. Some good choices:

| Model | Download | Size | Notes |
|---|---|---|---|
| Gemma 3 4B | `ollama pull gemma3:4b` | ~3 GB | Good balance of speed and quality |
| Qwen 3 4B | `ollama pull qwen3:4b` | ~2.5 GB | Fast, accurate |
| Llama 3.2 3B | `ollama pull llama3.2:3b` | ~2 GB | Lightweight, good for older machines |
| Gemma 3 12B | `ollama pull gemma3:12b` | ~8 GB | Better quality, needs 16 GB+ RAM |

You can use any other chat model from the [Ollama library](https://ollama.com/library).

## Privacy

- Your text is sent **only** to the Ollama server set in the extension (by default `localhost`, which is your own computer). It never goes to the extension author or anyone else.
- The extension collects no data and has no analytics.
- **Exception:** Ollama also offers *cloud* models (names ending in `-cloud`). If you pick one, Ollama sends your text to ollama.com. The settings mark these models clearly.

## Troubleshooting

**"Can't reach Ollama"**: Ollama isn't running. Start the Ollama app or run `ollama serve`, then click ↻ in the settings.

**"No Ollama models found"**: download a model first, for example `ollama pull gemma3:4b`.

**"Ollama refused the request (403)"**: the extension normally works around Ollama's block on browser extensions. If you still get this error, allow extensions in Ollama and restart Ollama:

- macOS:
  ```bash
  launchctl setenv OLLAMA_ORIGINS "moz-extension://*,chrome-extension://*"
  ```
- Windows (PowerShell):
  ```powershell
  setx OLLAMA_ORIGINS "moz-extension://*,chrome-extension://*"
  ```
- Linux (systemd): run `sudo systemctl edit ollama`, add `Environment="OLLAMA_ORIGINS=moz-extension://*,chrome-extension://*"` under `[Service]`, then run `sudo systemctl restart ollama`.

**The ✓ button doesn't appear**: reload the page. Pages that were already open when you installed the extension need a reload. Also check that the on/off switch is on. Browsers don't let extensions run on built-in pages such as `about:` and `chrome://` pages or the extension stores.

**Checks are slow**: try a smaller model. Checks can be up to 6,000 characters, and shorter selections are faster.

---

## Development

```
extension/            the extension source (Firefox manifest)
  background.js       Ollama requests, model list, context menu, shortcut
  content.js          selection detection, ✓ button, suggestion card, applying fixes
  popup.html/js/css   settings popup
manifest.chrome.json  Chrome/Edge manifest (build.sh swaps it in)
build.sh              builds dist/firefox, dist/chrome and the .xpi / .zip packages
sign-firefox.sh       signs the Firefox add-on through addons.mozilla.org
make_icons.py         regenerates the icons (Python standard library only)
```

There's no build step and no dependencies: the extension is plain JavaScript. To make a change, edit the files in `extension/` and reload the extension in your browser.

**Build packages:**

```bash
./build.sh
```

**Sign for Firefox** (needs free API keys from [addons.mozilla.org](https://addons.mozilla.org/developers/addon/api/key/)). First increase `"version"` in `extension/manifest.json`, because Mozilla won't sign the same version twice:

```bash
./sign-firefox.sh
```

The signed `.xpi` is saved to `dist/signed/`.

**Lint for Firefox:**

```bash
npx web-ext lint --source-dir extension
```

## License

[MIT](LICENSE.md). Free to use, modify and share.
