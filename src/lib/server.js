#!/usr/bin/env node
import express from "express";
import { Builder, By, until } from "selenium-webdriver";
import { Options as ChromeOptions, ServiceBuilder } from "selenium-webdriver/chrome.js";
import firefox from "selenium-webdriver/firefox.js";
const { Options: FirefoxOptions, Profile: FirefoxProfile } = firefox;
import fs from "fs";
import path from "path";

// --- Global state ---
const state = {
  drivers: new Map(),
  currentSession: null,
};

// --- Fonction pour trouver le chemin de chromedriver ---
function findChromeDriverPath() {
  const possiblePaths = [
    process.env.CHROMEDRIVER_BIN,
    "/usr/bin/chromedriver",
    "/usr/lib/chromium/chromedriver",
    "/usr/bin/chromium-chromedriver",
  ].filter(Boolean);
  for (const candidate of possiblePaths) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (err) {
      // chemin non accessible, continuer
    }
  }
  throw new Error("Chromedriver executable not found in any known path. Vérifiez son installation.");
}

// --- Fonction utilitaire pour obtenir un locator ---
function getLocator(by, value) {
  const strategies = {
    id: By.id,
    css: By.css,
    xpath: By.xpath,
    name: By.name,
    tag: By.tagName,
    class: By.className,
  };
  const strategy = strategies[by.toLowerCase()];
  if (!strategy) {
    throw new Error(`Unsupported locator strategy: ${by}`);
  }
  return strategy(value);
}

// --- Fonction pour démarrer une session de navigateur ---
async function startBrowser({ browser, options = {} }) {
  if (Array.isArray(options)) options = { arguments: options };
  const builder = new Builder();
  let driver;
  if (browser === "chrome") {
    const chromeOptions = new ChromeOptions();
    process.env.DBUS_SESSION_BUS_ADDRESS = process.env.DBUS_SESSION_BUS_ADDRESS || "/dev/null";
    const chromeBinary = process.env.CHROME_BIN || "/usr/bin/chromium";
    chromeOptions.setChromeBinaryPath(chromeBinary);
    const userDataDir = fs.mkdtempSync(path.join("/tmp", "chrome-data-"));
    chromeOptions.addArguments(
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--use-gl=swiftshader",
      `--user-data-dir=${userDataDir}`
    );
    if (options.arguments) {
      options.arguments.forEach(arg => chromeOptions.addArguments(arg));
    }
    const chromeDriverPath = findChromeDriverPath();
    const chromeService = new ServiceBuilder(chromeDriverPath);
    driver = await builder.forBrowser("chrome").setChromeOptions(chromeOptions).setChromeService(chromeService).build();
  } else if (browser === "firefox") {
    const firefoxOptions = new FirefoxOptions();
    // Création d'un profil temporaire pour Firefox
    const userDataDir = fs.mkdtempSync(path.join("/tmp", "firefox-profile-"));
    const profile = new FirefoxProfile();
    profile.setPreference("browser.cache.disk.parent_directory", userDataDir);
    firefoxOptions.setProfile(profile);
    if (options.headless) {
      firefoxOptions.addArguments("--headless");
    }
    if (options.arguments) {
      options.arguments.forEach(arg => firefoxOptions.addArguments(arg));
    }
    driver = await builder.forBrowser("firefox").setFirefoxOptions(firefoxOptions).build();
  } else {
    throw new Error("Browser must be 'chrome' or 'firefox'.");
  }
  const sessionId = `${browser}_${Date.now()}`;
  state.drivers.set(sessionId, driver);
  state.currentSession = sessionId;
  return { sessionId, driver };
}

// --- Fonction utilitaire pour récupérer le driver ---
async function getDriver() {
  if (!state.currentSession && state.drivers.size > 0) {
    state.currentSession = state.drivers.keys().next().value;
  }
  let driver = state.drivers.get(state.currentSession);
  if (!driver) {
    // Auto-démarrage d'une session par défaut (Chrome en headless)
    const result = await startBrowser({ browser: "chrome", options: { headless: true } });
    driver = result.driver;
  }
  return driver;
}

// --- Création de l'API Express ---
const app = express();
app.use(express.json());

// POST /start_browser : démarre une session
app.post("/start_browser", async (req, res) => {
  try {
    const { browser, options } = req.body;
    const result = await startBrowser({ browser, options });
    res.json({ message: `Browser started with session_id: ${result.sessionId}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /navigate : navigue vers une URL
app.post("/navigate", async (req, res) => {
  try {
    const { url } = req.body;
    const driver = await getDriver();
    await driver.get(url);
    res.json({ message: `Navigated to ${url}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /find_element : recherche un élément
app.post("/find_element", async (req, res) => {
  try {
    const { by, value, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    await driver.wait(until.elementLocated(locator), timeout || 10000);
    res.json({ message: "Element found" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /click_element : clique sur un élément
app.post("/click_element", async (req, res) => {
  try {
    const { by, value, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    await element.click();
    res.json({ message: "Element clicked" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /send_keys : envoie du texte à un élément
app.post("/send_keys", async (req, res) => {
  try {
    const { by, value, text, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    await element.clear();
    await element.sendKeys(text);
    res.json({ message: `Text "${text}" entered into element` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /get_element_text : récupère le texte d'un élément
app.post("/get_element_text", async (req, res) => {
  try {
    const { by, value, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    const text = await element.getText();
    res.json({ message: text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /hover : survole un élément
app.post("/hover", async (req, res) => {
  try {
    const { by, value, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    const actions = driver.actions({ bridge: true });
    await actions.move({ origin: element }).perform();
    res.json({ message: "Hovered over element" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /drag_and_drop : effectue un drag and drop
app.post("/drag_and_drop", async (req, res) => {
  try {
    const { by, value, targetBy, targetValue, timeout } = req.body;
    const driver = await getDriver();
    const sourceLocator = getLocator(by, value);
    const targetLocator = getLocator(targetBy, targetValue);
    const sourceElement = await driver.wait(until.elementLocated(sourceLocator), timeout || 10000);
    const targetElement = await driver.wait(until.elementLocated(targetLocator), timeout || 10000);
    const actions = driver.actions({ bridge: true });
    await actions.dragAndDrop(sourceElement, targetElement).perform();
    res.json({ message: "Drag and drop completed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /double_click : double-clic sur un élément
app.post("/double_click", async (req, res) => {
  try {
    const { by, value, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    const actions = driver.actions({ bridge: true });
    await actions.doubleClick(element).perform();
    res.json({ message: "Double click performed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /right_click : clic droit sur un élément
app.post("/right_click", async (req, res) => {
  try {
    const { by, value, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    const actions = driver.actions({ bridge: true });
    await actions.contextClick(element).perform();
    res.json({ message: "Right click performed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /press_key : simule l'appui sur une touche
app.post("/press_key", async (req, res) => {
  try {
    const { key } = req.body;
    const driver = await getDriver();
    const actions = driver.actions({ bridge: true });
    await actions.keyDown(key).keyUp(key).perform();
    res.json({ message: `Key '${key}' pressed` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /upload_file : upload d'un fichier via un input de type file
app.post("/upload_file", async (req, res) => {
  try {
    const { by, value, filePath, timeout } = req.body;
    const driver = await getDriver();
    const locator = getLocator(by, value);
    const element = await driver.wait(until.elementLocated(locator), timeout || 10000);
    await element.sendKeys(filePath);
    res.json({ message: "File upload initiated" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /take_screenshot : capture d'écran (enregistre dans un fichier ou renvoie la base64)
app.post("/take_screenshot", async (req, res) => {
  try {
    const { outputPath } = req.body;
    const driver = await getDriver();
    const screenshot = await driver.takeScreenshot();
    if (outputPath) {
      await fs.promises.writeFile(outputPath, screenshot, "base64");
      res.json({ message: `Screenshot saved to ${outputPath}` });
    } else {
      res.json({ message: "Screenshot captured as base64", screenshot });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /browser-status : retourne le statut de la session
app.get("/browser-status", (req, res) => {
  if (state.currentSession) {
    res.json({ status: `Active browser session: ${state.currentSession}` });
  } else {
    res.json({ status: "No active browser session" });
  }
});

// --- Gestion du nettoyage ---
async function cleanup() {
  for (const [sessionId, driver] of state.drivers) {
    try {
      await driver.quit();
    } catch (e) {
      console.error(`Error closing browser session ${sessionId}:`, e);
    }
  }
  state.drivers.clear();
  state.currentSession = null;
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// --- Démarrage du serveur HTTP ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Selenium service is listening on port ${PORT}`);
});
