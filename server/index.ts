import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { databaseId, definitions, query, secrets, closePools } from './databases.js';
import { databaseIds, initialCounts } from './fixtures.js';
import { tables, schema, rows, relationships, quality } from './explorer.js';
import { scripts, runScenario, history, type Action } from './scenarios.js';
import { createSchoolSite, escolePort } from './escoles.js';
import { createSources, sourceId, htmlConnection } from './sources.js';
const app = Fastify({ logger: false, bodyLimit: 8192 });
const schoolSite = await createSchoolSite();
const sources = createSources(schoolSite);
const sessions = new Map<string, { csrf: string; expires: number }>();
await app.register(cookie);
app.addHook('onRequest', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY');
  reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  const path = request.url.split('?')[0];
  if (!path.startsWith('/api/')) return;
  reply.header('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    const origin = request.headers.origin;
    if (origin !== `http://${request.headers.host}`) return reply.code(403).send({ error: 'Origen no autorizado' });
    if (!request.headers['content-type']?.startsWith('application/json')) return reply.code(415).send({ error: 'Se requiere JSON' });
  }
  if (request.method === 'GET') return;
  const session = sessions.get(request.cookies.veciana_session || '');
  if (!session || session.expires < Date.now() || request.headers['x-csrf-token'] !== session.csrf) return reply.code(403).send({ error: 'Sesion local invalida; recarga la pagina' });
});
app.get('/api/session', async (request, reply) => {
  const now = Date.now();
  const existing = sessions.get(request.cookies.veciana_session || '');
  if (existing && existing.expires > now) return { csrf: existing.csrf };
  const token = randomBytes(32).toString('hex'); const csrf = randomBytes(24).toString('hex');
  if (sessions.size > 1000) sessions.clear();
  sessions.set(token, { csrf, expires: now + 8 * 3600000 });
  reply.setCookie('veciana_session', token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 8 * 3600 });
  return { csrf };
});
app.get('/health', async (_, reply) => {
  try { for (const db of databaseIds) { const [state] = await query(db, 'SELECT status FROM _lab_state WHERE id=1', [], 'lab'); if (state?.status !== 'ready') throw new Error('not ready'); } return { status: 'ok' }; }
  catch { return reply.code(503).send({ status: 'unavailable' }); }
});
app.get('/api/databases', async () => Promise.all(databaseIds.map(async db => {
  const { label, engine, schema, port, internalPort } = definitions[db];
  try { const items = await tables(db); return { id: db, label, engine, schema, port, internalPort, status: 'online', tables: items, initialCounts: initialCounts[db] }; }
  catch { return { id: db, label, engine, schema, port, internalPort, status: 'offline', tables: [], initialCounts: initialCounts[db] }; }
})));
type Params = { db: string; table: string };
type SourceParams = { source: string; table: string };
app.get('/api/sources', sources.list);
app.get<{ Params: SourceParams; Querystring: Parameters<typeof rows>[2] }>('/api/source/:source/table/:table/rows', request => sources.rows(sourceId(request.params.source), request.params.table, request.query || {}));
app.get<{ Params: SourceParams }>('/api/source/:source/table/:table/schema', request => sources.schema(sourceId(request.params.source), request.params.table));
app.get<{ Params: SourceParams }>('/api/source/:source/relationships', request => sources.relationships(sourceId(request.params.source)));
app.get<{ Params: SourceParams }>('/api/source/:source/quality', request => sources.quality(sourceId(request.params.source)));
app.get<{ Params: SourceParams }>('/api/source/:source/scenarios', request => sources.scripts(sourceId(request.params.source)));
app.get<{ Params: SourceParams }>('/api/source/:source/history', request => sources.history(sourceId(request.params.source)));
app.post<{ Params: SourceParams; Body: { action: string; requestId: string; confirm: boolean } }>('/api/source/:source/scenario', async request => {
  if (request.body.confirm !== true) throw Object.assign(new Error('Confirmacion requerida'), { statusCode: 400 });
  return sources.run(sourceId(request.params.source), request.body.action, request.body.requestId);
});
app.get<{ Params: Params; Querystring: Parameters<typeof rows>[2] }>('/api/db/:db/table/:table/rows', request => rows(databaseId(request.params.db), request.params.table, request.query));
app.get<{ Params: Params }>('/api/db/:db/table/:table/schema', request => schema(databaseId(request.params.db), request.params.table));
app.get<{ Params: Params }>('/api/db/:db/relationships', request => relationships(databaseId(request.params.db)));
app.get<{ Params: Params }>('/api/db/:db/quality', request => quality(databaseId(request.params.db)));
app.get<{ Params: Params }>('/api/db/:db/scenarios', request => scripts(databaseId(request.params.db)));
app.get<{ Params: Params }>('/api/db/:db/history', request => history(databaseId(request.params.db)));
app.get('/api/connections', () => ({
  web: { host: 'localhost', port: Number(process.env.WEB_PORT || 8088), internalPort: 8080 },
  html: htmlConnection(),
  databases: databaseIds.map(db => ({ id: db, ...definitions[db], windowsHost: 'localhost', dockerHost: 'host.docker.internal',
    accounts: [{ role: 'OpenMetadata / lectura', username: 'openmetadata_reader', password: secrets.reader }, { role: 'Laboratorio / cambios', username: 'veciana_lab', password: secrets.lab }, { role: 'Administrador / arranque', username: definitions[db].admin, password: definitions[db].adminPassword }] }))
}));
app.post<{ Params: Params; Body: { action: Action; requestId: string; confirm: boolean } }>('/api/db/:db/scenario', async request => {
  if (request.body.confirm !== true) throw Object.assign(new Error('Confirmacion requerida'), { statusCode: 400 });
  return runScenario(databaseId(request.params.db), request.body.action, request.body.requestId);
});
app.post<{ Body: { confirm: string; requestId: string } }>('/api/reset', async request => {
  if (request.body.confirm !== 'RESTAURAR TODO') throw Object.assign(new Error('Confirmacion requerida'), { statusCode: 400 });
  return sources.reset(request.body.requestId);
});
app.setErrorHandler((error, request, reply) => {
  const failure: Error & { statusCode?: number } = error instanceof Error ? error : new Error('Fallo de servicio');
  const status = typeof failure.statusCode === 'number' ? failure.statusCode : 500;
  if (status >= 500) console.error(`Solicitud ${request.id}: fallo de servicio`);
  reply.code(status).send({ error: status === 502 ? failure.message : status >= 500 ? 'No se pudo completar la operacion. Revisa la fuente y la bitacora.' : failure.message });
});
await app.register(staticFiles, { root: resolve('dist/web'), list: false });
app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: 'Ruta no disponible' }) : reply.sendFile('index.html'));
app.addHook('onClose', closePools);
app.addHook('onClose', async () => { await schoolSite.app.close(); });
await schoolSite.app.listen({ host: process.env.APP_HOST || '127.0.0.1', port: escolePort });
await app.listen({ host: process.env.APP_HOST || (process.argv.includes('--local') ? '127.0.0.1' : '0.0.0.0'), port: Number(process.env.APP_PORT || 8080) });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void app.close(); });
console.log(`Veciana: backend en ${process.env.APP_PORT || 8080}; Escoles en ${escolePort}`);