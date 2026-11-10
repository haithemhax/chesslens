import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const venvPython = join(rootDir, 'vision-service', '.venv', 'Scripts', 'python.exe');
const serviceScript = join(rootDir, 'vision-service', 'service.py');

let pythonCmd = 'python';
let pythonArgs = [serviceScript];

if (existsSync(venvPython)) {
  pythonCmd = venvPython;
  pythonArgs = [serviceScript];
} else {
  pythonCmd = 'py';
  pythonArgs = ['-3.11', serviceScript];
}

console.log(`[vision] Starting Python Vision Service using ${pythonCmd}...`);
const child = spawn(pythonCmd, pythonArgs, { stdio: 'inherit' });

child.on('error', (err) => {
  console.error('[vision] Failed to start Python service:', err.message);
  console.log('[vision] Please run: powershell -ExecutionPolicy Bypass -File scripts/setup-python.ps1');
});

child.on('exit', (code) => {
  console.log(`[vision] Python service exited with code ${code}`);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
