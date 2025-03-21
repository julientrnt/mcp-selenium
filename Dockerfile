FROM node:18-alpine

# Installation de Chrome et dépendances
RUN apk update && apk add --no-cache \
    chromium \
    chromium-chromedriver \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev \
    ttf-opensans \
    chromium-chromedriver

# Variables d'environnement pour Chrome
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/lib/chromium/
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Copier les fichiers package
COPY package*.json ./

# Installer les dépendances
RUN npm install

# Copier le code de l'application
COPY . .

# Lancer le serveur via le script de lancement qui gère stdio
CMD ["node", "bin/mcp-selenium.js"]
