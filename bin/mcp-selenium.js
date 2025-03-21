#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = resolve(__dirname, '../src/lib/server.js');

// Start the server
const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
    console.log(`MCP Server stdout: ${data}`);
});
child.stderr.on('data', (data) => {
    console.error(`MCP Server stderr: ${data}`);
});
child.on('exit', (code, signal) => {
    console.log(`MCP Server exited with code ${code} and signal ${signal}`);
});
child.on('error', (error) => {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
});

child.on('error', (error) => {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
});

// Handle process termination
process.on('SIGTERM', () => {
    child.kill('SIGTERM');
});

process.on('SIGINT', () => {
    child.kill('SIGINT');
});