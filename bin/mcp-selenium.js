#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = resolve(__dirname, '../src/lib/server.js');

// Démarre le serveur en lançant "node serverPath"
const child = spawn('node', [serverPath], {
    stdio: 'inherit'
});

child.on('error', (error) => {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
});

// Gestion de l'arrêt du processus
process.on('SIGTERM', () => {
    child.kill('SIGTERM');
});
process.on('SIGINT', () => {
    child.kill('SIGINT');
});
