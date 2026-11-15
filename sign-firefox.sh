#!/bin/sh
# Signs the Firefox add-on through addons.mozilla.org (unlisted = private, not in the public store).
# Get API keys at https://addons.mozilla.org/developers/addon/api/key/
# Keys can come from AMO_JWT_ISSUER / AMO_JWT_SECRET, otherwise you are prompted.
set -e
cd "$(dirname "$0")"

if [ -z "$AMO_JWT_ISSUER" ]; then
  printf "AMO JWT issuer (user:12345:678): "
  read -r AMO_JWT_ISSUER
fi
if [ -z "$AMO_JWT_SECRET" ]; then
  printf "AMO JWT secret (hidden): "
  stty -echo; read -r AMO_JWT_SECRET; stty echo; echo
fi

mkdir -p dist/signed
WEB_EXT_API_KEY="$AMO_JWT_ISSUER" WEB_EXT_API_SECRET="$AMO_JWT_SECRET" \
  npx --yes web-ext@10.8.0 sign \
    --source-dir extension \
    --artifacts-dir dist/signed \
    --channel unlisted

echo
echo "Signed add-on:"
ls -1 dist/signed/*.xpi
echo "Open that .xpi with Firefox (or drag it into a Firefox window) to install it permanently."
