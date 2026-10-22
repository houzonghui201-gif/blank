import http from 'node:http';
import net from 'node:net';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {settings, xrayConfig} from './settings.mjs';

const s = settings();
const runtimeDir = mkdtempSync(join(tmpdir(), 'personal-xray-'));
const configPath = join(runtimeDir, 'config.json');
writeFileSync(configPath, JSON.stringify(xrayConfig(s)), {mode:0o600});
const binary = process.env.XRAY_BIN || '/usr/local/bin/xray';
execFileSync(binary, ['run','-test','-config',configPath], {stdio:['ignore','ignore','pipe']});
const child = spawn(binary, ['run','-config',configPath], {stdio:['ignore','ignore','pipe']});
child.stderr.on('data', () => {}); // Do not publish client destinations or credentials in service logs.
let stopping = false;
let ready = false;
const sockets = new Set();

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  server.close();
  for (const socket of sockets) socket.destroy();
  child.kill('SIGTERM');
  rmSync(runtimeDir, {recursive:true,force:true});
  setTimeout(() => process.exit(code), 500).unref();
}

const server = http.createServer((req, res) => {
  const headers = {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, headers).end('Method not allowed\n'); return;
  }
  let code = 404, body = 'Not found\n';
  if (req.url === '/healthz') { code = ready ? 200 : 503; body = ready ? 'ok\n' : 'starting\n'; }
  else if (req.url === `/sub/${s.token}`) {
    code = 200;
    body = Buffer.from(s.nodeUri+'\n').toString('base64');
    headers['profile-update-interval'] = '24';
  }
  res.writeHead(code, headers).end(req.method === 'HEAD' ? undefined : body);
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
server.on('clientError', (_, socket) => socket.destroy());
server.on('error', () => { console.error('HTTP listener failed.'); stop(1); });

server.on('upgrade', (req, socket, head) => {
  if (!ready || req.method !== 'GET' || req.url !== s.wsPath || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return;
  }
  const upstream = net.createConnection({host:'127.0.0.1',port:10001});
  const timer = setTimeout(() => { upstream.destroy(); socket.destroy(); }, 10000);
  upstream.once('connect', () => {
    clearTimeout(timer);
    upstream.setNoDelay(true);
    socket.setNoDelay(true);
    let raw = `GET ${s.wsPath} HTTP/1.1\r\n`;
    for (let i=0; i<req.rawHeaders.length; i+=2) {
      if (/^(x-forwarded-for|forwarded|x-real-ip)$/i.test(req.rawHeaders[i])) continue;
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}\r\n`;
    }
    upstream.write(raw+'\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  const cleanup = () => { clearTimeout(timer); upstream.destroy(); socket.destroy(); };
  upstream.on('error', cleanup);
  socket.on('error', cleanup);
  upstream.on('close', cleanup);
  socket.on('close', cleanup);
});

child.once('error', () => { console.error('Xray failed to start.'); stop(1); });
child.once('exit', () => { if (!stopping) { console.error('Xray exited; stopping service.'); stop(1); } });
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());

for (let attempt=0; attempt<50 && !stopping; attempt++) {
  ready = await new Promise(resolve => {
    const test = net.createConnection({host:'127.0.0.1',port:10001});
    test.setTimeout(200);
    test.once('connect', () => {test.destroy();resolve(true);});
    test.once('error', () => resolve(false));
    test.once('timeout', () => {test.destroy();resolve(false);});
  });
  if (ready) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) { console.error('Xray readiness check failed.'); stop(1); }
else server.listen(s.port, '0.0.0.0', () => console.log('Xray gateway ready.'));
