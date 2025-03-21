#!/bin/bash
set -e

echo "Installation des dépendances système..."

if command -v apt-get >/dev/null 2>&1; then
  echo "Système basé sur apt-get détecté (Debian/Ubuntu)"
  sudo apt-get update
  sudo apt-get install -y chromium-browser chromium-chromedriver libnss3 libxss1 libappindicator3-1 libindicator7 fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libdrm2 libgbm1 libgtk-3-0
elif command -v apk >/dev/null 2>&1; then
  echo "Système basé sur apk détecté (Alpine)"
  sudo apk update
  sudo apk add --no-cache chromium chromium-chromedriver nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont udev ttf-opensans
else
  echo "Votre système ne supporte ni apt-get ni apk. Veuillez installer manuellement les dépendances système requises."
  exit 1
fi

echo "Installation des dépendances système terminée."
