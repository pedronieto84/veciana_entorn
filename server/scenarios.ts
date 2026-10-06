import { query, quote, transaction, type Executor } from './databases.js';
import { columns } from './explorer.js';
import { databaseIds, dni, type DatabaseId } from './fixtures.js';
import { seedDatabase } from './seed.js';
export const target: Record<DatabaseId, string> = { padron: 'ciudadanos', tributos: 'liquidaciones', expedientes: 'expedientes' };
export const actions = ['insert', 'update', 'add-column', 'change-type', 'workload', 'reset'] as const;
export type Action = typeof actions[number];
const locks = new Set<DatabaseId>();
let globalReset = false;
export function scripts(db: DatabaseId) {
  const table = target[db];
  const typeSql = db === 'padron' ? 'ALTER TABLE ciudadanos ALTER COLUMN telefono TYPE TEXT' : db === 'tributos' ? 'ALTER TABLE contribuyentes MODIFY COLUMN email_notificacion TEXT NULL COMMENT \'Correo para notificaciones simuladas\'' : 'ALTER TABLE expedientes ALTER COLUMN prioridad BIGINT NOT NULL';
  return [
    { id: 'insert', label: 'Anadir 5 registros', effect: 'datos', detail: `Cinco filas nuevas en ${table}; maximo 10 lotes por restauracion.`, sql: `INSERT INTO ${table} (...) VALUES (...); [5 filas, parametros generados]` },
    { id: 'update', label: 'Actualizar un registro', effect: 'datos', detail: 'Cambiar el contacto o la unidad del registro 1.', sql: db === 'padron' ? "UPDATE ciudadanos SET email='persona1.cambio@example.invalid' WHERE id=1" : db === 'tributos' ? "UPDATE contribuyentes SET email_notificacion='persona1.cambio@example.invalid' WHERE id=1" : "UPDATE expedientes SET unidad='Atencion Ciudadana' WHERE id=1" },
    { id: 'add-column', label: 'Anadir columna', effect: 'estructura', detail: `Columna canal_origen nullable en ${table}; una vez hasta restaurar.`, sql: `ALTER TABLE ${table} ADD canal_origen VARCHAR(30) NULL` },
    { id: 'change-type', label: 'Cambiar tipo', effect: 'estructura', detail: 'Conversion sin perdida; una vez hasta restaurar.', sql: typeSql },
    { id: 'workload', label: 'Generar actividad SQL', effect: 'uso', detail: 'Ejecutar consultas de vistas y uniones para las estadisticas de uso.', sql: db === 'padron' ? 'SELECT * FROM v_hogares; SELECT * FROM v_poblacion_nucleo;' : db === 'tributos' ? 'SELECT * FROM v_deuda; SELECT * FROM v_recaudacion;' : 'SELECT * FROM v_expedientes_abiertos;' },
    { id: 'reset', label: 'Restaurar base', effect: 'restauracion', detail: 'Elimina cambios y vuelve al conjunto inicial. Conserva la bitacora.', sql: 'DROP VIEW / DROP TABLE [objetos municipales]; CREATE TABLE / INSERT [conjunto inicial]' }
  ];
}
async function snapshot(db: DatabaseId, table = target[db]) {
  const [count] = await query(db, `SELECT COUNT(*) AS total FROM ${quote(db, table)}`);
  return { table, count: Number(count.total), columns: (await columns(db, table)).map(({ name, type, nullable }) => ({ name, type, nullable: Boolean(nullable) })) };
}
async function insertBatch(db: DatabaseId, run: Executor) {
  const [state] = await run('SELECT batches FROM _lab_state WHERE id=1');
  if (Number(state.batches) >= 10) throw Object.assign(new Error('Limite de 10 lotes alcanzado; restaura la base'), { statusCode: 409 });
  const table = target[db];
  const [max] = await run(`SELECT MAX(id) AS maximum FROM ${quote(db, table)}`);
  for (let offset = 1; offset <= 5; offset++) {
    const id = Number(max.maximum || 0) + offset;
    const record = db === 'padron' ? { id, nombre: 'Habitante', apellidos: `Simulado ${id}`, dni: dni(40000000 + id), fecha_nacimiento: '1980-01-01', nacionalidad: 'ESP', hogar_id: 1, fecha_alta: '2026-10-06', email: `persona${id}@example.invalid`, telefono: `600${String(id).padStart(6, '0')}`, situacion: 'ACTIVO' }
      : db === 'tributos' ? { id, objeto_id: 1 + id % 36, ejercicio: 2026, referencia: `LAB-2026-${id}`, importe: 125, fecha_emision: '2026-10-06', fecha_vencimiento: '2026-12-31', estado: 'PENDIENTE' }
      : { id, codigo: `EXP-LAB-${id}`, ciudadano_id: 1 + id % 100, tipo_id: 1 + id % 5, asunto: 'Solicitud de prueba de ingesta', estado: 'REGISTRADO', fecha_apertura: '2026-10-06', fecha_cierre: null, prioridad: 1, unidad: 'Secretaria' };
    await run(`INSERT INTO ${quote(db, table)}(${Object.keys(record).map(name => quote(db, name)).join(',')}) VALUES(${Object.keys(record).map((_, index) => `@p${index}`).join(',')})`, Object.values(record));
  }
  await run('UPDATE _lab_state SET batches=batches+1 WHERE id=1');
}
export async function runScenario(db: DatabaseId, action: Action, requestId: string, internalReset = false) {
  if (globalReset && !internalReset) throw Object.assign(new Error('Restauracion global en curso'), { statusCode: 409 });
  if (!actions.includes(action)) throw Object.assign(new Error('Escenario desconocido'), { statusCode: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw Object.assign(new Error('Identificador de peticion invalido'), { statusCode: 400 });
  if (locks.has(db)) throw Object.assign(new Error('Hay una operacion en curso en esta base'), { statusCode: 409 });
  locks.add(db);
  try {
    const [existing] = await query(db, 'SELECT action,status,result FROM _lab_operations WHERE request_id=@p0', [requestId], 'lab');
    if (existing) {
      if (existing.action !== action) throw Object.assign(new Error('Identificador ya utilizado por otro escenario'), { statusCode: 409 });
      if (existing.status === 'done') return JSON.parse(existing.result);
      throw Object.assign(new Error('Peticion incompleta o fallida; revisa la bitacora y restaura antes de continuar'), { statusCode: 409 });
    }
    const incomplete = await query(db, "SELECT request_id FROM _lab_operations WHERE status IN ('pending','failed')", [], 'lab');
    if (incomplete.length && action !== 'reset') throw Object.assign(new Error('Operacion interrumpida; restaura esta base'), { statusCode: 409 });
    const [state] = await query(db, 'SELECT status FROM _lab_state WHERE id=1', [], 'lab');
    if (state?.status !== 'ready' && action !== 'reset') throw Object.assign(new Error('Inicializacion incompleta; restaura esta base'), { statusCode: 409 });
    const changedTable = action === 'change-type' && db === 'tributos' || action === 'update' && db === 'tributos' ? 'contribuyentes' : target[db];
    const before = state?.status === 'ready' ? await snapshot(db, changedTable) : null;
    await query(db, "INSERT INTO _lab_operations(request_id,action,status,created_at) VALUES(@p0,@p1,'pending',@p2)", [requestId, action, new Date().toISOString()], 'lab');
    const spec = scripts(db).find(script => script.id === action)!;
    let alreadyApplied = false;
    try {
      if (action === 'reset') {
        await seedDatabase(db, true);
        await query(db, "UPDATE _lab_operations SET status='interrupted' WHERE status IN ('pending','failed') AND request_id<>@p0", [requestId], 'lab');
      } else if (action === 'insert' || action === 'update') {
        await transaction(db, async run => {
          if (action === 'insert') await insertBatch(db, run); else await run(spec.sql);
          const [count] = await run(`SELECT COUNT(*) AS total FROM ${quote(db, changedTable)}`);
          const result = { db, action, requestId, sql: spec.sql, before, after: { ...before, count: Number(count.total) }, alreadyApplied: false, at: new Date().toISOString() };
          await run("UPDATE _lab_operations SET status='done',result=@p0 WHERE request_id=@p1", [JSON.stringify(result), requestId]);
        });
        const [operation] = await query(db, 'SELECT result FROM _lab_operations WHERE request_id=@p0', [requestId], 'lab');
        return JSON.parse(operation.result);
      } else if (action === 'add-column') {
        alreadyApplied = Boolean(before?.columns.some(column => column.name === 'canal_origen'));
        if (!alreadyApplied) await query(db, spec.sql, [], 'lab');
      } else if (action === 'change-type') {
        const name = db === 'padron' ? 'telefono' : db === 'tributos' ? 'email_notificacion' : 'prioridad';
        const changed = before?.columns.find(column => column.name === name);
        alreadyApplied = Boolean(changed && /^(text|bigint)$/i.test(changed.type));
        if (!alreadyApplied) await query(db, spec.sql, [], 'lab');
      } else await query(db, spec.sql, [], 'reader');
      const after = await snapshot(db, changedTable);
      if (action === 'add-column' && !after.columns.some(column => column.name === 'canal_origen')) throw new Error('Postcondicion de columna incumplida');
      if (action === 'change-type' && !after.columns.some(column => /^(text|bigint)$/i.test(column.type))) throw new Error('Postcondicion de tipo incumplida');
      const result = { db, action, requestId, sql: spec.sql, before, after, alreadyApplied, at: new Date().toISOString() };
      await query(db, "UPDATE _lab_operations SET status='done',result=@p0 WHERE request_id=@p1", [JSON.stringify(result), requestId], 'lab');
      return result;
    } catch (error) {
      await query(db, "UPDATE _lab_operations SET status='failed',result=@p0 WHERE request_id=@p1", [JSON.stringify({ error: 'Operacion fallida; DDL puede haber aplicado cambios parciales. Revisa el esquema y restaura.', before }), requestId], 'lab');
      throw error;
    }
  } finally { locks.delete(db); }
}
export async function history(db: DatabaseId) {
  const limit = db === 'expedientes' ? 'TOP 50' : '';
  const tail = db === 'expedientes' ? '' : 'LIMIT 50';
  const records = await query(db, `SELECT ${limit} request_id,action,status,created_at,result FROM _lab_operations ORDER BY created_at DESC ${tail}`, [], 'lab');
  return records.map(row => ({ ...row, result: row.result ? JSON.parse(row.result) : null }));
}
export async function resetAll(requestId: string) {
  if (globalReset || databaseIds.some(db => locks.has(db))) throw Object.assign(new Error('Hay operaciones en curso'), { statusCode: 409 });
  globalReset = true;
  const results = [];
  try {
    for (const db of databaseIds) {
      try { results.push({ db, success: true, result: await runScenario(db, 'reset', requestId, true) }); }
      catch { results.push({ db, success: false, error: 'Fallo parcial de restauracion; revisa esta base' }); }
    }
    return results;
  } finally { globalReset = false; }
}