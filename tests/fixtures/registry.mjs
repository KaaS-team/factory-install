import { createServer } from 'node:http';

export async function startRegistry() {
  const packuments = new Map();
  const tarballs = new Map();
  const published = [];
  const requests = [];
  let url = '';

  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    requests.push(`${req.method} ${path}`);
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(body);
    };
    if (req.method === 'PUT' && path.startsWith('/') && !path.startsWith('/-/')) {
      const name = decodeURIComponent(path.slice(1));
      if (!req.headers.authorization) return send(401, '{"error":"auth required"}');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const doc = packuments.get(name) ?? { name, 'dist-tags': {}, versions: {} };
        for (const [version, manifest] of Object.entries(body.versions ?? {})) {
          const file = `${name.split('/').pop()}-${version}.tgz`;
          const att = body._attachments[`${name}-${version}.tgz`] ?? Object.values(body._attachments)[0];
          tarballs.set(file, Buffer.from(att.data, 'base64'));
          manifest.dist = { ...manifest.dist, tarball: `${url}/-/${file}` };
          doc.versions[version] = manifest;
        }
        Object.assign(doc['dist-tags'], body['dist-tags'] ?? {});
        packuments.set(name, doc);
        published.push(name);
        send(201, '{"ok":true}');
      });
      return;
    }
    if (req.method === 'GET' && path.startsWith('/-/')) {
      const t = tarballs.get(decodeURIComponent(path.slice(3)));
      return t ? send(200, t, 'application/octet-stream') : send(404, '{}');
    }
    if (req.method === 'GET') {
      const doc = packuments.get(decodeURIComponent(path.slice(1)));
      return doc ? send(200, JSON.stringify(doc)) : send(404, '{"error":"not found"}');
    }
    send(404, '{}');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  return { url, published, requests, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}
