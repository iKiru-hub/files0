import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
let server, building = false, queued = false, timer, stopping = false;
const run = (cmd, args) => new Promise(resolve => { const child = spawn(cmd, args, { stdio: 'inherit' }); child.on('exit', code => resolve(code)); });
async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  const code = await run('npm', ['run', 'build']);
  if (code === 0 && !stopping) {
    if (server) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
    server = spawn(process.execPath, ['dist/server.js', ...process.argv.slice(2)], { stdio: 'inherit' });
    server.once('exit', () => { server = undefined; });
  }
  building = false;
  if (queued && !stopping) { queued = false; void rebuild(); }
}
const watcher = watch('webserver', { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(rebuild, 150); });
function stop() { stopping = true; watcher.close(); clearTimeout(timer); server?.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
await rebuild();
