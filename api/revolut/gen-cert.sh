#!/usr/bin/env bash
# Revolut Business API – tanúsítvány készítése (egyszer, a saját gépeden futtasd).
# A privatecert.pem és a private_pkcs8.pem TITKOS: soha ne töltsd fel a repóba vagy a chatbe.
set -euo pipefail
mkdir -p ~/webbridge-secrets/revolut && cd ~/webbridge-secrets/revolut
openssl genrsa -out privatecert.pem 2048
openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825 -subj "/C=EE/O=Tactical Edge Systems OU/CN=webbridge.hu"
# A Cloudflare Worker (Web Crypto) PKCS#8 formátumot kér:
openssl pkcs8 -topk8 -nocrypt -in privatecert.pem -out private_pkcs8.pem
echo "Kész. Ezt másold be a Revolutba (Settings > APIs > Business API > Add API certificate):"
cat publiccert.cer
