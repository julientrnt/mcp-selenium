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
      console.log("Démarrage de start_browser avec options :", options);
      // Si options est un tableau, on le convertit en objet avec la clé "arguments"
      if (Array.isArray(options)) {
        options = { arguments: options };
      }
      let builder = new Builder();
      let driver;
      if (browser === "chrome") {
        const chromeOptions = new ChromeOptions();

        // Forcer le chemin du binaire : utiliser CHROME_BIN ou /usr/bin/chromium
        const chromeBinary = process.env.CHROME_BIN || '/usr/bin/chromium';
        console.log("Chemin du binaire Chrome:", chromeBinary);
        chromeOptions.setChromeBinaryPath(chromeBinary);

        // Créer un répertoire de données utilisateur unique pour cette session
        const uniqueChromeDataDir = fs.mkdtempSync(path.join('/tmp', 'chrome-data-'));
        console.log("Répertoire de données utilisateur :", uniqueChromeDataDir);

        // Ajouter les flags indispensables pour un fonctionnement headless en tant que root
        chromeOptions.addArguments(
          "--headless",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          `--user-data-dir=${uniqueChromeDataDir}`
        );
        if (options.arguments) {
          options.arguments.forEach(arg => chromeOptions.addArguments(arg));
        }
        const chromeDriverPath = findChromeDriverPath();
        console.log("Chemin du chromedriver :", chromeDriverPath);
        const chromeService = new ServiceBuilder(chromeDriverPath);

        console.log("Construction du driver Chrome...");
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
        console.log("Construction du driver Firefox...");
        driver = await builder.forBrowser("firefox").setFirefoxOptions(firefoxOptions).build();
      }
      const sessionId = `${browser}_${Date.now()}`;
      state.drivers.set(sessionId, driver);
      state.currentSession = sessionId;
      console.log("Navigateur démarré avec la session :", sessionId);
      return {
        content: [{ type: "text", text: `Browser started with session_id: ${sessionId}` }],
      };
    } catch (e) {
      console.error("Erreur lors du démarrage du navigateur :", e);
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

// --- Outil pour survoler un élément ---
server.tool(
  "hover",
  "Moves the mouse to hover over an element",
  { ...locatorSchema },
  async ({ by, value, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      const actions = driver.actions({ bridge: true });
      await actions.move({ origin: element }).perform();
      return { content: [{ type: "text", text: "Hovered over element" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error hovering over element: ${e.message}` }] };
    }
  }
);

// --- Outil pour effectuer un drag and drop ---
server.tool(
  "drag_and_drop",
  "Drags an element and drops it onto another element",
  {
    ...locatorSchema,
    targetBy: z.enum(["id", "css", "xpath", "name", "tag", "class"]).describe("Locator strategy to find target element"),
    targetValue: z.string().describe("Value for the target locator strategy"),
  },
  async ({ by, value, targetBy, targetValue, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const sourceLocator = getLocator(by, value);
      const targetLocator = getLocator(targetBy, targetValue);
      const sourceElement = await driver.wait(until.elementLocated(sourceLocator), timeout);
      const targetElement = await driver.wait(until.elementLocated(targetLocator), timeout);
      const actions = driver.actions({ bridge: true });
      await actions.dragAndDrop(sourceElement, targetElement).perform();
      return { content: [{ type: "text", text: "Drag and drop completed" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error performing drag and drop: ${e.message}` }] };
    }
  }
);

// --- Outil pour effectuer un double clic sur un élément ---
server.tool(
  "double_click",
  "Performs a double click on an element",
  { ...locatorSchema },
  async ({ by, value, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      const actions = driver.actions({ bridge: true });
      await actions.doubleClick(element).perform();
      return { content: [{ type: "text", text: "Double click performed" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error performing double click: ${e.message}` }] };
    }
  }
);

// --- Outil pour effectuer un clic droit sur un élément ---
server.tool(
  "right_click",
  "Performs a right click (context click) on an element",
  { ...locatorSchema },
  async ({ by, value, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      const actions = driver.actions({ bridge: true });
      await actions.contextClick(element).perform();
      return { content: [{ type: "text", text: "Right click performed" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error performing right click: ${e.message}` }] };
    }
  }
);

// --- Outil pour simuler l'appui sur une touche du clavier ---
server.tool(
  "press_key",
  "Simulates pressing a keyboard key",
  { key: z.string().describe("Key to press (e.g., 'Enter', 'Tab', 'a', etc.)") },
  async ({ key }) => {
    try {
      const driver = getDriver();
      const actions = driver.actions({ bridge: true });
      await actions.keyDown(key).keyUp(key).perform();
      return { content: [{ type: "text", text: `Key '${key}' pressed` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error pressing key: ${e.message}` }] };
    }
  }
);

// --- Outil pour uploader un fichier via un input de type file ---
server.tool(
  "upload_file",
  "Uploads a file using a file input element",
  { ...locatorSchema, filePath: z.string().describe("Absolute path to the file to upload") },
  async ({ by, value, filePath, timeout = 10000 }) => {
    try {
      const driver = getDriver();
      const locator = getLocator(by, value);
      const element = await driver.wait(until.elementLocated(locator), timeout);
      await element.sendKeys(filePath);
      return { content: [{ type: "text", text: "File upload initiated" }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error uploading file: ${e.message}` }] };
    }
  }
);

// --- Outil pour capturer une capture d'écran ---
server.tool(
  "take_screenshot",
  "Captures a screenshot of the current page",
  {
    outputPath: z.string().optional().describe("Optional path where to save the screenshot. If not provided, returns base64 data."),
  },
  async ({ outputPath }) => {
    try {
      const driver = getDriver();
      const screenshot = await driver.takeScreenshot();
      if (outputPath) {
        await fs.promises.writeFile(outputPath, screenshot, "base64");
        return { content: [{ type: "text", text: `Screenshot saved to ${outputPath}` }] };
      } else {
        return {
          content: [
            { type: "text", text: "Screenshot captured as base64:" },
            { type: "text", text: screenshot },
          ],
        };
      }
    } catch (e) {
      return { content: [{ type: "text", text: `Error taking screenshot: ${e.message}` }] };
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
