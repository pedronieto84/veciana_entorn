import { definitions } from './databases.js';
import { databaseIds, initialCounts, referenceDate, type DatabaseId } from './fixtures.js';
import * as explorer from './explorer.js';
import * as scenarios from './scenarios.js';
import { escoleFetchUrl, escolePort, escoleUrl, schoolScripts, type createSchoolSite } from './escoles.js';
import { extractTable, htmlError, selectRows, type RowOptions } from './html-source.js';

export type SourceId = DatabaseId | 'escoles';
const sourceIds: SourceId[] = [...databaseIds, 'escoles'];
const defaults = { padron: 'ciudadanos', tributos: 'liquidaciones', expedientes: 'expedientes', escoles: 'matriculas' };
export function sourceId(value: string): SourceId {
  if (!sourceIds.includes(value as SourceId)) throw htmlError('Fuente desconocida', 404);
  return value as SourceId;
}
export const htmlConnection = () => ({ id: 'escoles', label: 'Escoles', engine: 'Web HTML', port: escolePort, url: escoleUrl, dockerUrl: `http://host.docker.internal:${escolePort}/`, selector: '#matriculas' });
export function createSources(site: Awaited<ReturnType<typeof createSchoolSite>>, extractionUrl = escoleFetchUrl) {
  let resetting = false;
  const extract = () => extractTable(extractionUrl);
  const checkTable = (table: string) => { if (table !== 'matriculas') throw htmlError('Tabla desconocida', 404); };
  const relationships = (id: SourceId) => id === 'escoles' ? Promise.resolve([{ child: 'matriculas', column_name: 'ciudadano_id', parent: 'padron.ciudadanos', parent_column: 'id', logical: true }]) : explorer.relationships(id);
  async function list() {
    return Promise.all(sourceIds.map(async id => {
      const definition = id === 'escoles' ? { ...htmlConnection(), schema: '#matriculas' } : definitions[id];
      const type = id === 'escoles' ? 'html' : 'database';
      const common = { id, label: definition.label, engine: definition.engine, schema: definition.schema, port: definition.port, type, defaultObject: defaults[id], capabilities: { indexes: type === 'database', physicalRelationships: type === 'database', changes: true }, initialCounts: id === 'escoles' ? { matriculas: 20 } : initialCounts[id] };
      try {
        const tables = id === 'escoles' ? [{ name: 'matriculas', kind: 'HTML TABLE', count: (await extract()).rows.length }] : await explorer.tables(id);
        return { ...common, status: 'online', tables };
      } catch { return { ...common, status: 'offline', tables: id === 'escoles' ? [{ name: 'matriculas', kind: 'HTML TABLE', count: 0 }] : [] }; }
    }));
  }
  async function rows(id: SourceId, table: string, options: RowOptions) {
    if (id !== 'escoles') return explorer.rows(id, table, options);
    checkTable(table);
    return selectRows(await extract(), options);
  }
  async function schema(id: SourceId, table: string) {
    if (id !== 'escoles') return explorer.schema(id, table);
    checkTable(table);
    const data = await extract();
    return { columns: data.columns, indexes: [], relationships: await relationships(id), provenance: data.provenance, observed: true };
  }
  async function quality(id: SourceId) {
    if (id !== 'escoles') return explorer.quality(id);
    const data = await extract();
    const rules = [
      { rule: 'campos_obligatorios', column: 'nombre', description: 'Identificador, alumno, centro, curso y ano presentes', test: (row: Record<string, string>) => ['id', 'nombre', 'apellidos', 'codigo_escuela', 'escuela', 'ano_academico'].some(name => !row[name]) || !(row.curso || row.nivel) },
      { rule: 'matricula_unica', column: 'id', description: 'Identificador de matricula sin duplicados', test: (row: Record<string, string>) => data.rows.filter(other => other.id === row.id).length > 1 },
      { rule: 'fechas_coherentes', column: 'fecha_matricula', description: 'Nacimiento y matricula validos y no futuros', test: (row: Record<string, string>) => [row.fecha_nacimiento, row.fecha_matricula].some(value => !value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value > referenceDate) || row.fecha_matricula < row.fecha_nacimiento },
      { rule: 'curso_coherente', column: 'ano_academico', description: 'Curso y etapa coherentes con el nacimiento y el ano academico', test: (row: Record<string, string>) => {
        const age = 2026 - Number(row.fecha_nacimiento?.slice(0, 4));
        return row.ano_academico !== '2026-2027' || row.etapa !== (age >= 12 ? 'ESO' : 'Primaria') || Number(row.curso || row.nivel) !== age - (age >= 12 ? 11 : 5);
      } }
    ].map(({ test, ...rule }) => {
      const failed = data.rows.filter(test).map(row => Number(row.id));
      return { ...rule, table: 'matriculas', failed, ids: [], matchesExpected: failed.length === 0 };
    });
    return { source: 'Comprobaciones locales sobre HTML extraido; no resultados de OpenMetadata', referenceDate, rules, legitimateMissingDocuments: 0, provenance: data.provenance };
  }
  async function run(id: SourceId, action: string, requestId: string) {
    if (resetting) throw htmlError('Restauracion global en curso', 409);
    return id === 'escoles' ? site.run(action, requestId, extract) : scenarios.runScenario(id, action as scenarios.Action, requestId);
  }
  async function reset(requestId: string) {
    if (resetting || site.isBusy()) throw htmlError('Hay operaciones en curso', 409);
    resetting = true;
    try {
      const results: { db: SourceId; success: boolean; result?: unknown; error?: string }[] = await scenarios.resetAll(requestId);
      try { results.push({ db: 'escoles', success: true, result: await site.run('reset', requestId, extract) }); }
      catch { results.push({ db: 'escoles', success: false, error: 'Fallo de restauracion; revisa la web Escoles' }); }
      return results;
    } finally { resetting = false; }
  }
  return { list, rows, schema, relationships, quality, run, reset,
    scripts: (id: SourceId) => id === 'escoles' ? schoolScripts() : scenarios.scripts(id),
    history: (id: SourceId) => id === 'escoles' ? site.history() : scenarios.history(id) };
}