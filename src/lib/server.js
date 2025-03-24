#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from 'fs';
import path from 'path';
import { Builder, By, until } from "selenium-webdriver";
import { Options as ChromeOptions, ServiceBuilder } from "selenium-webdriver/chrome.js";
import { Options as FirefoxOptions } from "selenium-webdriver/firefox.js";

// --- Utiliser une classe personnalisée pour forcer l'initialisation de "tools" ---
class McpServerFixed extends McpServer {
  constructor(options) {
    super(options);
    if (!this.tools || !this.tools.list) {
      this.tools = { list: [] };
    }
  }
  tool(name, description, schema, handler) {
    this.tools.list.push({ name, description, schema });
    return super.tool(name, description, schema, handler);
  }
}

const server = new McpServerFixed({
  name: "MCP Selenium",
  version: "1.0.0"
});

// --- État du serveur ---
const state = {
  drivers: new Map(),
  currentSession: null,
};

// --- Fonctions utilitaires ---
const getDriver = () => {
  // Si aucune session active n'est définie mais qu'il y a des sessions, en sélectionne une
  if (!state.currentSession && state.drivers.size > 0) {
    state.currentSession = state.drivers.keys().next().value;
  }
  const driver = state.drivers.get(state.currentSession);
  if (!driver) {
    throw new Error("No active browser session. Please start a browser session using the start_browser tool.");
  }
  return driver;
};

const getLocator = (by, value) => {
  switch (by.toLowerCase()) {
    case "id":
      return By.id(value);
    case "css":
      return By.css(value);
    case "xpath":
      return By.xpath(value);
    case "name":
      return By.name(value);
    case "tag":
      return By.tagName(value);
    case "class":
      return By.className(value);
    default:
      throw new Error(`Unsupported locator strategy: ${by}`);
  }
};

// --- Schémas communs ---
const browserOptionsSchema = z
  .object({
    headless: z.boolean().optional().describe("Run browser in headless mode"),
    arguments: z.array(z.string()).optional().describe("Additional browser arguments"),
  })
  .optional();

const locatorSchema = {
  by: z
    .enum(["id", "css", "xpath", "name", "tag", "class"])
    .describe("Locator strategy to find element"),
  value: z.string().describe("Value for the locator strategy"),
  timeout: z.number().optional().describe("Maximum time to wait for element in milliseconds"),
};

// --- Fonction pour trouver chromedriver ---
function findChromeDriverPath() {
  const possiblePaths = [
    process.env.CHROMEDRIVER_BIN,
    '/usr/bin/chromedriver',
    '/usr/lib/chromium/chromedriver',
    '/usr/bin/chromium-chromedriver'
  ].filter(Boolean);
  for (const pathCandidate of possiblePaths) {
    try {
      fs.accessSync(pathCandidate, fs.constants.X_OK);
      return pathCandidate;
    } catch (err) {
      // chemin non accessible, continuer
    }
  }
  throw new Error("Chromedriver executable not found in any known path. Vérifiez son installation.");
}

// --- Outil pour lancer le navigateur ---
server.tool(
  "start_browser",
  "Launches a browser session",
  {
    browser: z.enum(["chrome", "firefox"]).describe("Browser to launch (chrome or firefox)"),
    options: browserOptionsSchema,
  },
  async ({ browser, options = {} }) => {
    try {
      // Si options est un tableau, on le convertit en objet avec la clé "arguments"
      if (Array.isArray(options)) {
        options = { arguments: options };
      }
      let builder = new Builder();
      let driver;
      if (browser === "chrome") {
        const chromeOptions = new ChromeOptions();

        // Définir DBUS_SESSION_BUS_ADDRESS pour éviter certains messages d'erreur
        process.env.DBUS_SESSION_BUS_ADDRESS = process.env.DBUS_SESSION_BUS_ADDRESS || "/dev/null";

        // Forcer le chemin du binaire : utiliser CHROME_BIN ou /usr/bin/chromium
        const chromeBinary = process.env.CHROME_BIN || '/usr/bin/chromium';
        chromeOptions.setChromeBinaryPath(chromeBinary);

        // Créer un répertoire de données utilisateur unique pour cette session
        const uniqueChromeDataDir = fs.mkdtempSync(path.join('/tmp', 'chrome-data-'));

        // Ajouter les flags indispensables pour un fonctionnement headless en tant que root
        // On ajoute --use-gl=swiftshader pour forcer le rendu logiciel
        chromeOptions.addArguments(
          "--headless",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--use-gl=swiftshader",
          `--user-data-dir=${uniqueChromeDataDir}`
        );
        if (options.arguments) {
          options.arguments.forEach(arg => chromeOptions.addArguments(arg));
        }
        const chromeDriverPath = findChromeDriverPath();
        const chromeService = new ServiceBuilder(chromeDriverPath);

        driver = await builder
          .forBrowser("chrome")
          .setChromeOptions(chromeOptions)
          .setChromeService(chromeService)
          .build();
      } else {
        const firefoxOptions = new FirefoxOptions();
        if (options.headless) {
          firefoxOptions.addArguments("--headless");
        }
        if (options.arguments) {
          options.arguments.forEach(arg => firefoxOptions.addArguments(arg));
        }
        driver = await builder.forBrowser("firefox").setFirefoxOptions(firefoxOptions).build();
      }
      const sessionId = `${browser}_${Date.now()}`;
      state.drivers.set(sessionId, driver);
      state.currentSession = sessionId;
      return {
        content: [{ type: "text", text: `Browser started with session_id: ${sessionId}` }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error starting browser: ${e.message}` }],
      };
    }
  }
);

// --- Outil pour naviguer vers une URL ---
server.tool(
  "navigate",
  "Navigates to a URL",
  {
    url: z.string().describe("URL to navigate to"),
  },
  async ({ url }) => {
    try {
      const driver = getDriver();
      await driver.get(url);
      return {
        content: [{ type: "text", text: `Navigated to ${url}` }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error navigating: ${e.message}` }],
      };
    }
  }
);

// --- Outil pour trouver un élément ---
server.tool(
  "find_element",
  "Finds an element",
  { ...locatorSchema },
  async ({ by, value, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      await driver.wait(until.elementLocated(locator), timeout);
      return { content: [{ type: "text", text: "Element found" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error finding element: ${e.message}` }] };
    }
  }
);

// --- Outil pour cliquer sur un élément ---
server.tool(
  "click_element",
  "Clicks an element",
  { ...locatorSchema },
  async ({ by, value, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      await element.click();
      return { content: [{ type: "text", text: "Element clicked" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error clicking element: ${e.message}` }] };
    }
  }
);

// --- Outil pour envoyer du texte à un élément ---
server.tool(
  "send_keys",
  "Sends keys to an element (typing)",
  { ...locatorSchema, text: z.string().describe("Text to enter into the element") },
  async ({ by, value, text, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      await element.clear();
      await element.sendKeys(text);
      return { content: [{ type: "text", text: `Text "${text}" entered into element` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error entering text: ${e.message}` }] };
    }
  }
);

// --- Outil pour récupérer le texte d'un élément ---
server.tool(
  "get_element_text",
  "Gets the text() of an element",
  { ...locatorSchema },
  async ({ by, value, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      const text = await element.getText();
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error getting element text: ${e.message}` }] };
    }
  }
);

// --- Ressource pour afficher le statut du navigateur ---
server.resource(
  "browser-status",
  new ResourceTemplate("browser-status://current"),
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: state.currentSession
          ? `Active browser session: ${state.currentSession}`
          : "No active browser session",
      },
    ],
  })
);

// --- Handler de nettoyage pour fermer les sessions du navigateur lors de l'arrêt ---
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

// --- Démarrage du serveur via le transport Stdio ---
(async () => {
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
  } catch (e) {
    console.error("Erreur lors de la connexion du serveur:", e);
    process.exit(1);
  }
})();
