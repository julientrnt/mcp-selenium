#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "selenium-webdriver";
const { Builder, By, Key, until, Actions } = pkg;
import { Options as ChromeOptions } from "selenium-webdriver/chrome.js";
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

const state = {
  drivers: new Map(),
  currentSession: null,
};

const getDriver = () => {
  const driver = state.drivers.get(state.currentSession);
  if (!driver) {
    throw new Error("No active browser session");
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

server.tool(
  "start_browser",
  "Launches a browser session. For Chrome in Docker, always use headless mode and pass the following arguments: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] to ensure correct operation.",
  {
    browser: z.enum(["chrome", "firefox"]).describe("Browser to launch (chrome or firefox)"),
    options: browserOptionsSchema,
  },
  async ({ browser, options = {} }) => {
    try {
      let builder = new Builder();
      let driver;

      if (browser === "chrome") {
        const chromeOptions = new ChromeOptions();

        chromeOptions.addArguments("--headless=new");
        chromeOptions.addArguments("--no-sandbox");
        chromeOptions.addArguments("--disable-dev-shm-usage");
        chromeOptions.addArguments("--disable-gpu");

        if (options.arguments) {
          options.arguments.forEach((arg) => chromeOptions.addArguments(arg));
        }

        driver = await builder.forBrowser("chrome").setChromeOptions(chromeOptions).build();
      } else {
        const firefoxOptions = new FirefoxOptions();

        firefoxOptions.addArguments("--headless");
        firefoxOptions.addArguments("--no-sandbox");
        firefoxOptions.addArguments("--disable-dev-shm-usage");
        firefoxOptions.addArguments("--disable-gpu");

        if (options.arguments) {
          options.arguments.forEach((arg) => firefoxOptions.addArguments(arg));
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

// --- Ajout des autres tools ---
// Ici, on garde le reste de tes tools (navigate, click_element, etc.) inchangés

// --- Définition d'une ressource pour afficher le statut du navigateur ---
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

// --- Handler de nettoyage ---
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

// --- Démarrage du serveur ---
const transport = new StdioServerTransport();
await server.connect(transport);