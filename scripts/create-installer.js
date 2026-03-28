const { spawn } = require('child_process');

function run() {
  const builder = spawn('npx.cmd', ['electron-builder', '--win', '--x64'], {
    stdio: 'inherit',
    shell: false
  });

  builder.on('close', (code) => {
    process.exit(code ?? 1);
  });

  builder.on('error', (error) => {
    console.error('Failed to run installer build:', error);
    process.exit(1);
  });
}

run();
