#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = resolve(__dirname, '../src/lib/server.js');

// Lancer le serveur MCP avec stdio en mode pipe
const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

// Afficher les sorties du serveur pour le debug
child.stdout.on('data', (data) => {
    console.log(`[MCP Server stdout]: ${data}`);
});
child.stderr.on('data', (data) => {
    console.error(`[MCP Server stderr]: ${data}`);
});
child.on('close', (code) => {
    console.log(`[MCP Server] exited with code ${code}`);
});
child.on('error', (err) => {
    console.error(`[MCP Server] error: ${err}`);
});
