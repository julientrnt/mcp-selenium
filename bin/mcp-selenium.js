#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = resolve(__dirname, '../src/lib/server.js');

// Lancer le serveur avec stdio en mode "pipe" pour que les flux puissent être utilisés par MCP.
// ATTENTION : N’écrivez PAS de messages non protocolaires sur stdout.
const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

// Pour débuguer, vous pouvez rediriger les logs vers stderr, mais évitez d’écrire sur stdout.
child.stdout.on('data', (data) => {
    // Si vous écrivez ici, veillez à filtrer les messages qui ne font pas partie du protocole MCP.
    process.stderr.write(`[MCP Server stdout]: ${data}`);
});
child.stderr.on('data', (data) => {
    process.stderr.write(`[MCP Server stderr]: ${data}`);
});
child.on('close', (code) => {
    process.stderr.write(`[MCP Server] exited with code ${code}\n`);
});
child.on('error', (err) => {
    process.stderr.write(`[MCP Server] error: ${err}\n`);
    process.exit(1);
});
