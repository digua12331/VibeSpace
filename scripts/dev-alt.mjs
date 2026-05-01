import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const pnpmArgs = ['-r', '--parallel', 'run', 'dev'];
const command = isWin ? process.env.ComSpec || 'cmd.exe' : 'pnpm';
const args = isWin ? ['/d', '/s', '/c', 'pnpm', ...pnpmArgs] : pnpmArgs;

const child = spawn(command, args, {
  stdio: 'inherit',
  windowsVerbatimArguments: isWin,
  env: {
    ...process.env,
    AIMON_PORT: '9787',
    AIMON_WEB_PORT: '9788',
    AIMON_SKIP_HOOK_INSTALL: '1',
    AIMON_WEB_ORIGIN: 'http://127.0.0.1:9788,http://localhost:9788',
    AIMON_BACKEND_URL: 'http://127.0.0.1:9787',
    VITE_AIMON_BACKEND: 'http://127.0.0.1:9787',
    VITE_AIMON_INSTANCE_LABEL: '开发',
  },
});

child.on('error', (error) => {
  console.error('[dev-alt] failed to start pnpm:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
