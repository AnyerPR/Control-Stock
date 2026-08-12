const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const env = Object.assign({}, process.env, {
  BUILD_SINGLE: 'true',
});

const viteScript = path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteScript, 'build', '--outDir', 'dist/single'], {
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error('Failed to run Vite build for single-file output:', result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status);
}

const source = path.resolve(__dirname, '..', 'dist', 'single', 'index.html');
const targets = [
  path.resolve(__dirname, '..', 'index_2.html'),
  path.resolve(__dirname, '..', 'index_todo_en_uno.html'),
  path.resolve(__dirname, '..', 'dist', 'index_2.html'),
  path.resolve(__dirname, '..', 'dist', 'index_todo_en_uno.html'),
];

for (const target of targets) {
  fs.copyFileSync(source, target);
}

fs.rmSync(path.resolve(__dirname, '..', 'dist', 'single'), { recursive: true, force: true });
console.log('Built single-file output and copied index variants successfully.');
