#!/bin/sh
# Packages the extension for Firefox and Chrome into dist/.
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/firefox dist/chrome

cp -R extension/. dist/firefox/
cp -R extension/. dist/chrome/
cp manifest.chrome.json dist/chrome/manifest.json
rm -f dist/*/.amo-upload-uuid dist/*/.DS_Store

(cd dist/firefox && zip -qr ../local-grammar-firefox.xpi .)
(cd dist/chrome && zip -qr ../local-grammar-chrome.zip .)
echo "Built:"
ls -1 dist
