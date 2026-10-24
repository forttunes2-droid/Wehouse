import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCatalogTransport } from '../scripts/lib/catalog-transport.mjs';

test('catalog transport reuses a bounded TCP pool without dropping concurrent posts', async () => {
  let connections = 0, requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(body); });
  });
  server.on('connection', () => { connections++; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const transport = createCatalogTransport(`http://127.0.0.1:${server.address().port}`, { maxSockets: 4 });
  try {
    const results = await Promise.all(Array.from({ length: 64 }, (_, id) => transport.post('/rpc', {}, { id })));
    assert.equal(requests, 64); assert.ok(connections <= 4);
    assert.deepEqual(results.map(result => JSON.parse(result.body).id), Array.from({ length: 64 }, (_, id) => id));
    assert.ok(results.every(result => result.ok && result.status === 200));
    assert.ok(results.every(result=>result.timing.queue_ms>=0&&result.timing.response_ms>=0&&result.timing.headers_ms>=0));
    await assert.rejects(transport.post('https://example.com/rpc', {}, {}), /change origin/);
  } finally { transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('catalog deadline includes time waiting for the TCP pool', async () => {
  const server = http.createServer(() => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const transport = createCatalogTransport(`http://127.0.0.1:${server.address().port}`, { maxSockets: 1, timeout: 100 });
  try {
    const start = performance.now();
    const results = await Promise.allSettled([transport.post('/slow', {}, {}), transport.post('/queued', {}, {})]);
    assert.ok(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
    assert.ok(results.every(result=>result.reason.catalogTiming.queue_ms>=0));
    // The first abort may free its socket in the same event-loop turn as the
    // queued deadline. Unix can assign that socket just before the second
    // abort, producing response_ms=0 rather than null. The measured queue and
    // absence of response headers are the actual distinction we require.
    assert.ok(results[1].reason.catalogTiming.queue_ms>=70,'the queued request must retain its measured pool wait');
    assert.equal(results[1].reason.catalogTiming.headers_ms,null,'the queued deadline must not manufacture response headers');
    assert.ok(performance.now() - start < 1500, 'queued requests must not wait indefinitely');
  } finally { transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('catalog transport keeps remote requests on TLS and validates its socket budget', () => {
  assert.throws(() => createCatalogTransport('http://example.com'), /HTTPS/);
  assert.throws(() => createCatalogTransport('https://example.com', { maxSockets: 0 }), /budget/);
  assert.throws(() => createCatalogTransport('https://example.com', { maxSockets: 2049 }), /budget/);
});
