import http from 'node:http';
import https from 'node:https';
import {createGunzip,createBrotliDecompress,createInflate} from 'node:zlib';

/** Keep the generator's TCP budget explicit; queued time counts in the deadline. */
export function createCatalogTransport(origin, { maxSockets = 128, timeout = 15000 } = {}) {
  const base = new URL(origin);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) throw new Error('HTTPS catalog origin required');
  if (!Number.isSafeInteger(maxSockets) || maxSockets < 1 || maxSockets > 2048 || !Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid transport budget');
  const protocol = base.protocol === 'https:' ? https : http;
  const agent = new protocol.Agent({ keepAlive: true, maxSockets, maxTotalSockets: maxSockets, maxFreeSockets: maxSockets });
  return {
    maxSockets,
    post(path, headers, payload) {
      const target = new URL(path, base);
      if (target.origin !== base.origin) return Promise.reject(new Error('Catalog request cannot change origin'));
      const body = JSON.stringify(payload);
      return new Promise((resolve, reject) => {
        const started=performance.now();let socketAt=null,headersAt=null,wireBytes=0;
        const timing=()=>({queue_ms:Math.round((socketAt??performance.now())-started),
          response_ms:socketAt===null?null:Math.round(performance.now()-socketAt),
          headers_ms:headersAt===null||socketAt===null?null:Math.round(headersAt-socketAt),wire_bytes:wireBytes});
        const fail=error=>{error.catalogTiming=timing();reject(error);};
        const request = protocol.request(target, {
          method: 'POST', agent, signal: AbortSignal.timeout(timeout),
          headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),'accept-encoding':'gzip, deflate, br' },
        }, response => {
          headersAt=performance.now();
          const chunks = [];let decodedBytes=0;
          const encoding=String(response.headers['content-encoding']||'identity').toLowerCase();
          if(!['identity','gzip','br','deflate'].includes(encoding)){response.resume();fail(Error('Unsupported catalog response encoding'));return;}
          const decoder=encoding==='gzip'?createGunzip():encoding==='br'?createBrotliDecompress():encoding==='deflate'?createInflate():null;
          const decoded=decoder?response.pipe(decoder):response;
          response.on('data',chunk=>{wireBytes+=chunk.length;});
          decoded.on('data', chunk => {chunks.push(chunk);decodedBytes+=chunk.length;});
          response.on('error', fail);
          if(decoder)decoder.on('error',fail);
          decoded.on('end', () => resolve({ status: response.statusCode || 0,
            ok: response.statusCode >= 200 && response.statusCode < 300,
            body: Buffer.concat(chunks).toString('utf8'),decoded_bytes:decodedBytes,encoding,timing:timing() }));
        });
        request.on('socket',()=>{socketAt=performance.now();});
        request.on('error', fail);
        request.end(body);
      });
    },
    close() { agent.destroy(); },
  };
}
