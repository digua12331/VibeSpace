import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const args = ['-r', '--parallel', 'run', 'dev'];

const child = spawn(command, args, {
  stdio: 'inherit',
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
