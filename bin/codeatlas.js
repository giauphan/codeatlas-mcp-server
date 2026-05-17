#!/usr/bin/env node

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Load API Key from environment or arguments or local .env
let apiKey = process.env.CODEATLAS_API_KEY;

// Check command line arguments for --apiKey=<value> or -k <value>
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--apiKey=')) {
    apiKey = args[i].split('=')[1];
  } else if (args[i] === '-k' || args[i] === '--apiKey') {
    apiKey = args[i + 1];
  }
}

// Fallback to local .env file in the current working directory
if (!apiKey) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/CODEATLAS_API_KEY=["']?([^"'\s]+)["']?/);
      if (match) {
        apiKey = match[1];
      }
    }
  } catch (e) {
    // Ignore .env read error
  }
}

if (!apiKey) {
  console.error('Error: CODEATLAS_API_KEY is not set.');
  console.error('Please set it in your environment variables, a local .env file, or pass it as an argument:');
  console.error('  codeatlas-mcp --apiKey=YOUR_API_KEY');
  process.exit(1);
}

// Target remote SSE URL
const sseUrl = `https://atlas.genrostore.com/sse?apiKey=${apiKey}`;

console.error(`Connecting to CodeAtlas Remote Server via Supergateway...`);
console.error(`SSE URL: https://atlas.genrostore.com/sse?apiKey=***`);

// Spawn supergateway
// We try to run the local/global 'supergateway' binary first.
// If it fails or is not found, we run it via npx.
const gatewayArgs = ['--sse', sseUrl];

let child;
try {
  child = spawn('supergateway', gatewayArgs, { stdio: 'inherit' });
} catch (err) {
  // If global 'supergateway' is not found, spawn it via 'npx'
  child = spawn('npx', ['-y', 'supergateway', ...gatewayArgs], { stdio: 'inherit' });
}

child.on('error', (err) => {
  console.error('Failed to start supergateway process:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
