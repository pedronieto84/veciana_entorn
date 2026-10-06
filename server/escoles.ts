import Fastify from 'fastify';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fixtures } from './fixtures.js';
import { htmlError, parseTable, type HtmlRow } from './html-source.js';

export const escolePort = Number(process.env.ESCOLES_PORT || 8090);
export const escoleUrl = `http://localhost:${escolePort}/`;
export const escoleFetchUrl = `http://127.0.0.1:${escolePort}/`;
const schoolNames = ['Escola de Veciana', 'Escola Sant Pere', 'Institut de la Vall'];
const headings = ['Id', 'Ciudadano id', 'Nombre', 'Apellidos', 'Fecha nacimiento', 'Codigo escuela', 'Escuela', 'Municipio escuela', 'Etapa', 'Curso', 'Ano academico', 'Fecha matricula', 'Estado'];
const names = headings.map(heading => heading.toLowerCase().replaceAll(' ', '_'));
export function initialEnrollments(): HtmlRow[] {
  return fixtures().padron.ciudadanos.slice(80).map((citizen, index) => {
    const age = 2026 - Number(String(citizen.fecha_nacimiento).slice(0, 4));
    const secondary = age >= 12;
    const school = secondary ? 2 : index % 2;
    return { id: String(index + 1), ciudadano_id: String(citizen.id), nombre: String(citizen.nombre), apellidos: String(citizen.apellidos),
      fecha_nacimiento: String(citizen.fecha_nacimiento), codigo_escuela: `00${school + 1}`, escuela: schoolNames[school], municipio_escuela: 'Veciana',
      etapa: secondary ? 'ESO' : 'Primaria', curso: String(age - (secondary ? 11 : 5)), ano_academico: '2026-2027', fecha_matricula: '2026-09-07', estado: 'ACTIVA' };
  });
}
export const schoolScripts = () => [
  { id: 'insert', label: 'Anadir 5 matriculas', effect: 'datos', detail: 'Cinco alumnos ficticios nuevos, sin referencia padronal. Maximo 10 lotes.', preview: 'Publicar cinco nuevas filas <tr> en la tabla de matriculas.' },
  { id: 'update', label: 'Actualizar una matricula', effect: 'datos', detail: 'Trasladar la primera matricula a Escola Sant Pere.', preview: 'Cambiar codigo_escuela y escuela en la primera fila HTML.' },
  { id: 'add-column', label: 'Anadir columna HTML', effect: 'estructura', detail: 'Publicar una columna Beca, inicialmente NO.', preview: 'Anadir <th>Beca</th> y una celda por matricula.' },
  { id: 'rename-column', label: 'Renombrar encabezado', effect: 'estructura', detail: 'Cambiar Curso por Nivel para probar cambios de estructura.', preview: 'Sustituir <th>Curso</th> por <th>Nivel</th>.' },
  { id: 'reset', label: 'Restaurar web', effect: 'restauracion', detail: 'Volver a las 20 matriculas iniciales. Conserva la bitacora.', preview: 'Restaurar la tabla HTML inicial y sus encabezados.' }
];
type Snapshot = ReturnType<typeof parseTable>;
interface Operation { db: 'escoles'; action: string; requestId: string; preview: string; before: { table: string; count: number; columns: Snapshot['columns'] }; after: { table: string; count: number; columns: Snapshot['columns'] }; alreadyApplied: boolean; at: string }
interface SchoolState { rows: HtmlRow[]; batches: number; addedColumn: boolean; renamedColumn: boolean; operations: Operation[] }
const initialState = (): SchoolState => ({ rows: initialEnrollments(), batches: 0, addedColumn: false, renamedColumn: false, operations: [] });
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function validateState(value: unknown): asserts value is SchoolState {
  if (!value || typeof value !== 'object') throw new Error('Estado Escoles invalido');
  const state = value as SchoolState;
  if (!Array.isArray(state.rows) || state.rows.length < 1 || state.rows.length > 70 || !Number.isInteger(state.batches) || state.batches < 0 || state.batches > 10 || typeof state.addedColumn !== 'boolean' || typeof state.renamedColumn !== 'boolean' || !Array.isArray(state.operations)) throw new Error('Estado Escoles invalido');
  const fields = [...names.map(name => name === 'curso' && state.renamedColumn ? 'nivel' : name), ...(state.addedColumn ? ['beca'] : [])];
  if (state.rows.some(row => !row || fields.some(name => typeof row[name] !== 'string') || Object.keys(row).length !== fields.length) || new Set(state.rows.map(row => row.id)).size !== state.rows.length) throw new Error('Matriculas Escoles invalidas');
  if (state.operations.some(operation => !operation || operation.db !== 'escoles' || !schoolScripts().some(script => script.id === operation.action) || typeof operation.requestId !== 'string' || !operation.after || !operation.before || typeof operation.at !== 'string')) throw new Error('Bitacora Escoles invalida');
}
export async function createSchoolSite(file = resolve('.local/escoles.json')) {
  let state = initialState();
  try { const saved: unknown = JSON.parse(await readFile(file, 'utf8')); validateState(saved); state = saved; }
  catch (failure) { if (!(failure instanceof Error && 'code' in failure && failure.code === 'ENOENT')) throw failure; }
  let busy = false;
  const render = () => {
    const labels = headings.map(heading => state.renamedColumn && heading === 'Curso' ? 'Nivel' : heading);
    if (state.addedColumn) labels.push('Beca');
    const fields = [...names.map(name => name === 'curso' && state.renamedColumn ? 'nivel' : name), ...(state.addedColumn ? ['beca'] : [])];
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Escoles | Veciana</title><link rel="stylesheet" href="/styles.css"></head><body><header><div class="identity"><img src="/escuela.svg" width="36" height="36" alt=""><span>Veciana / Educacion</span></div><span class="badge">DATOS SINTETICOS</span></header><main><div class="heading"><div><p class="eyebrow">REGISTRO MUNICIPAL</p><h1>Escoles</h1><p>Matriculas · 2026-2027</p></div><strong class="count">${state.rows.length}<small>matriculas</small></strong></div><div class="table-scroll"><table id="matriculas"><caption>Alumnos y centros educativos</caption><thead><tr>${labels.map(label => `<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${state.rows.map(row => `<tr>${fields.map(field => `<td>${escapeHtml(row[field])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><footer>VECIANA / MUNICIPIO FICTICIO</footer></main></body></html>`;
  };
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (_, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  });
  app.get('/', (_, reply) => reply.type('text/html; charset=utf-8').send(render()));
  app.get('/styles.css', (_, reply) => reply.type('text/css').send(`:root{font-family:'Trebuchet MS',sans-serif;color:#202a30;background:#f5f7f8;letter-spacing:0}*{box-sizing:border-box}body{margin:0}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 28px;background:#fff;border-bottom:1px solid #dce3e7}.identity{display:flex;align-items:center;gap:12px;font-size:14px}.badge,.eyebrow,footer{font-size:10px;color:#70818a}.badge{border:1px solid #dce3e7;padding:6px}main{padding:28px;min-width:0;background:linear-gradient(#f7f9fa,#fff 240px)}.heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}h1{font-size:32px;font-weight:500;margin:8px 0}p{margin:8px 0;color:#70818a;font-size:13px}.count{font-size:28px;font-weight:500;text-align:right}.count small{display:block;font-size:11px;color:#70818a}.table-scroll{overflow-x:auto;border-block:1px solid #dce3e7}table{border-collapse:collapse;width:100%;text-align:left;white-space:nowrap;background:#fff;font-size:12px}caption{text-align:left;padding:16px 12px;font-size:14px;font-weight:600}th{background:#eef5ef;color:#506651;font-size:11px;font-weight:600}th,td{padding:12px;border-bottom:1px solid #edf1f3}tbody tr:hover{background:#f4f8f4}footer{padding:24px 0}@media(max-width:700px){header{padding:16px}.badge{font-size:8px}main{padding:20px 16px}.identity{font-size:12px}}`));
  app.get('/escuela.svg', async (_, reply) => {
    const { icons } = await import('lucide-react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    return reply.type('image/svg+xml').send(renderToStaticMarkup(createElement(icons.School, { color: '#527846', size: 36 })));
  });
  const history = () => state.operations.slice(-50).reverse().map(operation => ({ request_id: operation.requestId, action: operation.action, status: 'done', created_at: operation.at, result: operation }));
  async function run(action: string, requestId: string, snapshot: () => Promise<Snapshot> = async () => parseTable(render())) {
    const script = schoolScripts().find(item => item.id === action);
    if (!script || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw htmlError('Escenario o identificador de peticion invalido', 400);
    if (busy) throw htmlError('Hay una operacion en curso en Escoles', 409);
    const existing = state.operations.find(item => item.requestId === requestId);
    if (existing) {
      if (existing.action !== action) throw htmlError('Identificador ya utilizado por otro escenario', 409);
      return { ...existing, alreadyApplied: true };
    }
    busy = true;
    const previous = state;
    try {
      const before = await snapshot();
      state = structuredClone(state);
      let alreadyApplied = false;
      if (action === 'reset') state = { ...initialState(), operations: state.operations };
      if (action === 'insert') {
        if (state.batches >= 10) throw htmlError('Limite de 10 lotes alcanzado; restaura la web', 409);
        const maximum = Math.max(...state.rows.map(row => Number(row.id)));
        for (let offset = 1; offset <= 5; offset++) {
          const id = String(maximum + offset);
          state.rows.push({ ...state.rows[0], id, ciudadano_id: '', nombre: 'Alumno', apellidos: `Simulado ${id}`, fecha_nacimiento: '2017-05-10', codigo_escuela: '001', escuela: schoolNames[0], etapa: 'Primaria', [state.renamedColumn ? 'nivel' : 'curso']: '4' });
        }
        state.batches++;
      }
      if (action === 'update') { state.rows[0].codigo_escuela = '002'; state.rows[0].escuela = schoolNames[1]; }
      if (action === 'add-column') {
        alreadyApplied = state.addedColumn;
        state.addedColumn = true;
        for (const row of state.rows) row.beca ||= 'NO';
      }
      if (action === 'rename-column') {
        alreadyApplied = state.renamedColumn;
        if (!state.renamedColumn) for (const row of state.rows) { row.nivel = row.curso; delete row.curso; }
        state.renamedColumn = true;
      }
      const after = await snapshot();
      const summarize = (value: Snapshot) => ({ table: 'matriculas', count: value.rows.length, columns: value.columns });
      const result: Operation = { db: 'escoles', action, requestId, preview: script.preview, before: summarize(before), after: summarize(after), alreadyApplied, at: new Date().toISOString() };
      state.operations.push(result);
      validateState(state);
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(state), 'utf8');
      await rename(temporary, file);
      return result;
    } catch (failure) { state = previous; throw failure; }
    finally { busy = false; }
  }
  return { app, run, history, render, isBusy: () => busy };
}