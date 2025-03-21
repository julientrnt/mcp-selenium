#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = resolve(__dirname, '../src/lib/server.js');

// Lancer le serveur avec stdio en mode "pipe"
const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

// Rediriger stdout et stderr du serveur vers stderr (afin de ne pas interférer avec la communication MCP sur stdout)
child.stdout.on('data', (data) => {
    process.stderr.write(`[MCP Server stdout]: ${data}`);
});
child.stderr.on('data', (data) => {
    process.stderr.write(`[MCP Server stderr]: ${data}`);
});
child.on('close', (code) => {
    process.stderr.write(`[MCP Server] exited with code ${code}\n`);
});
child.on('error', (error) => {
    process.stderr.write(`[MCP Server] error: ${error.message}\n`);
    process.exit(1);
});

// Propager les signaux pour arrêter le sous-processus proprement
process.on('SIGTERM', () => {
    child.kill('SIGTERM');
});
process.on('SIGINT', () => {
    child.kill('SIGINT');
});
