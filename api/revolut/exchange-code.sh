#!/usr/bin/env bash
# Egyszeri lépés: a Revolut jóváhagyás után kapott ?code=... értékből refresh tokent készít.
# Használat: ./exchange-code.sh <CLIENT_ID> <CODE>
# A kód 2 percig érvényes, ezért a jóváhagyás után azonnal futtasd.
set -euo pipefail
CLIENT_ID="$1"; CODE="$2"; ISS="webbridge.hu"
KEY=~/webbridge-secrets/revolut/privatecert.pem
b64url(){ openssl base64 -e -A | tr '+/' '-_' | tr -d '='; }
HDR=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
EXP=$(( $(date +%s) + 300 ))
PAY=$(printf '{"iss":"%s","sub":"%s","aud":"https://revolut.com","exp":%s}' "$ISS" "$CLIENT_ID" "$EXP" | b64url)
SIG=$(printf '%s.%s' "$HDR" "$PAY" | openssl dgst -sha256 -sign "$KEY" | b64url)
JWT="$HDR.$PAY.$SIG"
curl -s https://b2b.revolut.com/api/1.0/auth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=authorization_code" \
  --data "code=$CODE" \
  --data "client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer" \
  --data "client_assertion=$JWT"
echo
echo "A válaszban lévő refresh_token értékét tedd a Cloudflare titkai közé:"
echo "  npx wrangler secret put REVOLUT_REFRESH_TOKEN"
