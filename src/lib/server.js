// Redirige tous les logs vers stderr pour ne pas polluer stdout (réservé au protocole MCP)
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

// Empêche le processus de se terminer en laissant stdin ouvert
process.stdin.setEncoding('utf8');
process.stdin.resume();

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from 'selenium-webdriver';
const { Builder, By, Key, until, Actions } = pkg;
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FirefoxOptions } from 'selenium-webdriver/firefox.js';

// Création du serveur MCP
const server = new McpServer({
    name: "MCP Selenium",
    version: "1.0.0"
});

// État interne pour gérer les sessions de navigateur
const state = {
    drivers: new Map(),
    currentSession: null
};

// Fonction utilitaire pour récupérer le driver actif
const getDriver = () => {
    const driver = state.drivers.get(state.currentSession);
    if (!driver) {
        throw new Error('No active browser session');
    }
    return driver;
};

// Fonction pour construire un localisateur en fonction de la stratégie
const getLocator = (by, value) => {
    switch (by.toLowerCase()) {
        case 'id': return By.id(value);
        case 'css': return By.css(value);
        case 'xpath': return By.xpath(value);
        case 'name': return By.name(value);
        case 'tag': return By.tagName(value);
        case 'class': return By.className(value);
        default: throw new Error(`Unsupported locator strategy: ${by}`);
    }
};

// Schéma de validation pour les options du navigateur
const browserOptionsSchema = z.object({
    headless: z.boolean().optional().describe("Run browser in headless mode"),
    arguments: z.array(z.string()).optional().describe("Additional browser arguments")
}).optional();

// Schéma pour définir un localisateur d'élément
const locatorSchema = {
    by: z.enum(["id", "css", "xpath", "name", "tag", "class"]).describe("Locator strategy to find element"),
    value: z.string().describe("Value for the locator strategy"),
    timeout: z.number().optional().describe("Maximum time to wait for element in milliseconds")
};

// --- Outils MCP ---

// Outil pour démarrer un navigateur
server.tool(
    "start_browser",
    "launches browser",
    {
        browser: z.enum(["chrome", "firefox"]).describe("Browser to launch (chrome or firefox)"),
        options: browserOptionsSchema
    },
    async ({ browser, options = {} }) => {
        try {
            let builder = new Builder();
            let driver;

            if (browser === 'chrome') {
                const chromeOptions = new ChromeOptions();
                if (options.headless) {
                    chromeOptions.addArguments('--headless=new');
                }
                if (options.arguments) {
                    options.arguments.forEach(arg => chromeOptions.addArguments(arg));
                }
                driver = await builder
                    .forBrowser('chrome')
                    .setChromeOptions(chromeOptions)
                    .build();
            } else {
                const firefoxOptions = new FirefoxOptions();
                if (options.headless) {
                    firefoxOptions.addArguments('--headless');
                }
                if (options.arguments) {
                    options.arguments.forEach(arg => firefoxOptions.addArguments(arg));
                }
                driver = await builder
                    .forBrowser('firefox')
                    .setFirefoxOptions(firefoxOptions)
                    .build();
            }

            const sessionId = `${browser}_${Date.now()}`;
            state.drivers.set(sessionId, driver);
            state.currentSession = sessionId;

            return {
                content: [{ type: 'text', text: `Browser started with session_id: ${sessionId}` }]
            };
        } catch (e) {
            return {
                content: [{ type: 'text', text: `Error starting browser: ${e.message}` }]
            };
        }
    }
);

// Outil pour naviguer vers une URL
server.tool(
    "navigate",
    "navigates to a URL",
    {
        url: z.string().describe("URL to navigate to")
    },
    async ({ url }) => {
        try {
            const driver = getDriver();
            await driver.get(url);
            return { content: [{ type: 'text', text: `Navigated to ${url}` }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error navigating: ${e.message}` }] };
        }
    }
);

// Outil pour trouver un élément
server.tool(
    "find_element",
    "finds an element",
    {
        ...locatorSchema
    },
    async ({ by, value, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            await driver.wait(until.elementLocated(locator), timeout);
            return { content: [{ type: 'text', text: 'Element found' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error finding element: ${e.message}` }] };
        }
    }
);

// Outil pour cliquer sur un élément
server.tool(
    "click_element",
    "clicks an element",
    {
        ...locatorSchema
    },
    async ({ by, value, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            await element.click();
            return { content: [{ type: 'text', text: 'Element clicked' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error clicking element: ${e.message}` }] };
        }
    }
);

// Outil pour envoyer des touches (saisie) à un élément
server.tool(
    "send_keys",
    "sends keys to an element, aka typing",
    {
        ...locatorSchema,
        text: z.string().describe("Text to enter into the element")
    },
    async ({ by, value, text, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            await element.clear();
            await element.sendKeys(text);
            return { content: [{ type: 'text', text: `Text "${text}" entered into element` }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error entering text: ${e.message}` }] };
        }
    }
);

// Outil pour récupérer le texte d'un élément
server.tool(
    "get_element_text",
    "gets the text() of an element",
    {
        ...locatorSchema
    },
    async ({ by, value, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            const text = await element.getText();
            return { content: [{ type: 'text', text }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error getting element text: ${e.message}` }] };
        }
    }
);

// Outil pour survoler un élément avec la souris
server.tool(
    "hover",
    "moves the mouse to hover over an element",
    {
        ...locatorSchema
    },
    async ({ by, value, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            const actions = driver.actions({ bridge: true });
            await actions.move({ origin: element }).perform();
            return { content: [{ type: 'text', text: 'Hovered over element' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error hovering over element: ${e.message}` }] };
        }
    }
);

// Outil pour effectuer un drag and drop
server.tool(
    "drag_and_drop",
    "drags an element and drops it onto another element",
    {
        ...locatorSchema,
        targetBy: z.enum(["id", "css", "xpath", "name", "tag", "class"]).describe("Locator strategy for target element"),
        targetValue: z.string().describe("Value for the target locator")
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
            return { content: [{ type: 'text', text: 'Drag and drop completed' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error performing drag and drop: ${e.message}` }] };
        }
    }
);

// Outil pour effectuer un double-clic
server.tool(
    "double_click",
    "performs a double click on an element",
    {
        ...locatorSchema
    },
    async ({ by, value, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            const actions = driver.actions({ bridge: true });
            await actions.doubleClick(element).perform();
            return { content: [{ type: 'text', text: 'Double click performed' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error performing double click: ${e.message}` }] };
        }
    }
);

// Outil pour effectuer un clic droit (context click)
server.tool(
    "right_click",
    "performs a right click (context click) on an element",
    {
        ...locatorSchema
    },
    async ({ by, value, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            const actions = driver.actions({ bridge: true });
            await actions.contextClick(element).perform();
            return { content: [{ type: 'text', text: 'Right click performed' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error performing right click: ${e.message}` }] };
        }
    }
);

// Outil pour simuler l'appui sur une touche du clavier
server.tool(
    "press_key",
    "simulates pressing a keyboard key",
    {
        key: z.string().describe("Key to press (e.g., 'Enter', 'Tab', 'a', etc.)")
    },
    async ({ key }) => {
        try {
            const driver = getDriver();
            const actions = driver.actions({ bridge: true });
            await actions.keyDown(key).keyUp(key).perform();
            return { content: [{ type: 'text', text: `Key '${key}' pressed` }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error pressing key: ${e.message}` }] };
        }
    }
);

// Outil pour uploader un fichier via un input type="file"
server.tool(
    "upload_file",
    "uploads a file using a file input element",
    {
        ...locatorSchema,
        filePath: z.string().describe("Absolute path to the file to upload")
    },
    async ({ by, value, filePath, timeout = 10000 }) => {
        try {
            const driver = getDriver();
            const locator = getLocator(by, value);
            const element = await driver.wait(until.elementLocated(locator), timeout);
            await element.sendKeys(filePath);
            return { content: [{ type: 'text', text: 'File upload initiated' }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `Error uploading file: ${e.message}` }] };
        }
    }
);

// Outil pour prendre une capture d'écran
server.tool(
    "take_screenshot",
    "captures a screenshot of the current page",
    {
        outputPath: z.string().optional().describe("Optional path where to save the screenshot. If not provided, returns base64 data.")
    },
    async ({ outputPath }) => {
        try {
            const driver = getDriver();
            const screenshot = await driver.takeScreenshot();
            if (outputPath) {
                const fs = await import('fs');
                await fs.promises.writeFile(outputPath, screenshot, 'base64');
                return { content: [{ type: 'text', text: `Screenshot saved to ${outputPath}` }] };
            } else {
                return {
                    content: [
                        { type: 'text', text: 'Screenshot captured as base64:' },
                        { type: 'text', text: screenshot }
                    ]
                };
            }
        } catch (e) {
            return { content: [{ type: 'text', text: `Error taking screenshot: ${e.message}` }] };
        }
    }
);

// Ressource pour afficher l'état du navigateur
server.resource(
    "browser-status",
    new ResourceTemplate("browser-status://current"),
    async (uri) => ({
        contents: [{
            uri: uri.href,
            text: state.currentSession
                ? `Active browser session: ${state.currentSession}`
                : "No active browser session"
        }]
    })
);

// Fonction de nettoyage pour fermer toutes les sessions de navigateur proprement
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

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Connexion du serveur MCP en utilisant le transport stdio
const transport = new StdioServerTransport();
await server.connect(transport);
