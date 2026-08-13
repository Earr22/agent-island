const http = require('node:http');

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const payload = process.argv[2] || Buffer.concat(chunks).toString('utf8');
  if (!payload.trim()) return process.exit(0);
  const request = http.request({
    hostname: '127.0.0.1',
    port: 17321,
    path: '/hooks/codex',
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 2500
  }, (response) => { response.resume(); response.on('end', () => process.exit(0)); });
  request.on('error', () => process.exit(0));
  request.on('timeout', () => { request.destroy(); process.exit(0); });
  request.end(payload);
});
process.stdin.resume();
