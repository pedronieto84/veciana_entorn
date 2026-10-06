import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { query, quote, literal, closePools, secrets } from './databases.js';
import { fixtures, databaseIds, initialCounts, type DatabaseId } from './fixtures.js';
import { model, views, type Field } from './model.js';
function fieldType(db: DatabaseId, field: Field) {
  if (field.type === 'int') return 'INT';
  if (field.type === 'date') return 'DATE';
  if (field.type === 'money') return 'DECIMAL(12,2)';
  if (field.type === 'text') return db === 'expedientes' ? 'NVARCHAR(MAX)' : 'TEXT';
  return `${db === 'expedientes' ? 'NVARCHAR' : 'VARCHAR'}(${field.length || 120})`;
}
async function users(db: DatabaseId) {
  if (!Object.values(secrets).every(value => typeof value === 'string' && value.length > 0)) throw new Error('Faltan credenciales en .env');
  if (db === 'padron') {
    for (const [name, password] of [['veciana_lab', secrets.lab], ['openmetadata_reader', secrets.reader]]) {
      const exists = await query(db, 'SELECT 1 FROM pg_roles WHERE rolname=@p0', [name], 'admin');
      if (!exists.length) await query(db, `CREATE ROLE ${name} LOGIN PASSWORD ${literal(password)}`, [], 'admin');
    }
    await query(db, 'GRANT CONNECT ON DATABASE padron TO veciana_lab,openmetadata_reader; GRANT USAGE,CREATE ON SCHEMA public TO veciana_lab; GRANT USAGE ON SCHEMA public TO openmetadata_reader; ALTER DEFAULT PRIVILEGES FOR ROLE veciana_lab IN SCHEMA public GRANT SELECT ON TABLES TO openmetadata_reader; CREATE EXTENSION IF NOT EXISTS pg_stat_statements; GRANT pg_read_all_stats TO openmetadata_reader;', [], 'admin');
  } else if (db === 'tributos') {
    for (const [name, password] of [['veciana_lab', secrets.lab], ['openmetadata_reader', secrets.reader]]) await query(db, `CREATE USER IF NOT EXISTS '${name}'@'%' IDENTIFIED BY ${literal(password)}`, [], 'admin');
    await query(db, "GRANT ALL PRIVILEGES ON tributos.* TO 'veciana_lab'@'%'; GRANT SELECT,SHOW VIEW ON tributos.* TO 'openmetadata_reader'@'%'; GRANT SELECT ON mysql.general_log TO 'openmetadata_reader'@'%';", [], 'admin');
  } else {
    await query(db, "IF DB_ID('expedientes') IS NULL CREATE DATABASE expedientes", [], 'admin', true);
    for (const [name, password] of [['veciana_lab', secrets.lab], ['openmetadata_reader', secrets.reader]]) {
      await query(db, `IF NOT EXISTS(SELECT 1 FROM sys.sql_logins WHERE name=${literal(name)}) CREATE LOGIN ${name} WITH PASSWORD=${literal(password)}, CHECK_POLICY=OFF`, [], 'admin', true);
      await query(db, `IF NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE name=${literal(name)}) CREATE USER ${name} FOR LOGIN ${name}`, [], 'admin');
    }
    await query(db, 'ALTER ROLE db_owner ADD MEMBER veciana_lab; GRANT SELECT, VIEW DEFINITION, VIEW DATABASE PERFORMANCE STATE TO openmetadata_reader; ALTER DATABASE expedientes SET QUERY_STORE=ON (QUERY_CAPTURE_MODE=ALL, MAX_STORAGE_SIZE_MB=64, CLEANUP_POLICY=(STALE_QUERY_THRESHOLD_DAYS=7));', [], 'admin');
    await query(db, 'GRANT VIEW SERVER PERFORMANCE STATE TO openmetadata_reader;', [], 'admin', true);
  }
}
export async function seedDatabase(db: DatabaseId, reset = false) {
  await users(db);
  const stateTable = db === 'expedientes' ? "IF OBJECT_ID('dbo._lab_state','U') IS NULL CREATE TABLE _lab_state(id INT PRIMARY KEY,status VARCHAR(20) NOT NULL,batches INT NOT NULL)" : 'CREATE TABLE IF NOT EXISTS _lab_state(id INT PRIMARY KEY,status VARCHAR(20) NOT NULL,batches INT NOT NULL)';
  await query(db, stateTable, [], 'lab');
  const ops = `CREATE TABLE _lab_operations(request_id VARCHAR(36) PRIMARY KEY, action VARCHAR(30) NOT NULL, status VARCHAR(20) NOT NULL, created_at VARCHAR(30) NOT NULL, result ${db === 'expedientes' ? 'NVARCHAR(MAX)' : 'TEXT'} NULL)`;
  if (db === 'expedientes') await query(db, `IF OBJECT_ID('dbo._lab_operations','U') IS NULL ${ops}`, [], 'lab');
  else await query(db, ops.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'), [], 'lab');
  const state = await query(db, 'SELECT status FROM _lab_state WHERE id=1', [], 'lab');
  if (state[0]?.status === 'ready' && !reset) return;
  await query(db, 'DELETE FROM _lab_state', [], 'lab');
  await query(db, "INSERT INTO _lab_state(id,status,batches) VALUES(1,'preparing',0)", [], 'lab');
  for (const name of Object.keys(views[db])) await query(db, `DROP VIEW IF EXISTS ${quote(db, name)}`, [], 'lab');
  for (const name of Object.keys(model[db]).reverse()) await query(db, `DROP TABLE IF EXISTS ${quote(db, name)}`, [], 'lab');
  for (const [table, spec] of Object.entries(model[db])) {
    const columns = spec.fields.map(field => `${quote(db, field.name)} ${fieldType(db, field)}${field.name === 'id' ? ' PRIMARY KEY' : field.nullable ? ' NULL' : ' NOT NULL'}${field.ref ? ` REFERENCES ${quote(db, field.ref)}(id)` : ''}`);
    if (db === 'tributos') {
      for (const field of spec.fields.filter(field => field.ref)) {
        const index = columns.findIndex(column => column.startsWith(quote(db, field.name) + ' '));
        columns[index] = columns[index].split(' REFERENCES ')[0];
        columns.push(`FOREIGN KEY (${quote(db, field.name)}) REFERENCES ${quote(db, field.ref!)}(id)`);
      }
    }
    await query(db, `CREATE TABLE ${quote(db, table)}(${columns.join(',')})${db === 'tributos' ? ` ENGINE=InnoDB COMMENT=${literal(spec.description)}` : ''}`, [], 'lab');
    if (db === 'padron') await query(db, `COMMENT ON TABLE ${quote(db, table)} IS ${literal(spec.description)}`, [], 'lab');
    if (db === 'expedientes') await query(db, `EXEC sys.sp_addextendedproperty @name=N'MS_Description',@value=${literal(spec.description)},@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=${literal(table)}`, [], 'lab');
    for (const field of spec.fields) {
      if (db === 'padron') await query(db, `COMMENT ON COLUMN ${quote(db, table)}.${quote(db, field.name)} IS ${literal(field.description)}`, [], 'lab');
      if (db === 'tributos') await query(db, `ALTER TABLE ${quote(db, table)} MODIFY COLUMN ${quote(db, field.name)} ${fieldType(db, field)} ${field.nullable ? 'NULL' : 'NOT NULL'} COMMENT ${literal(field.description)}`, [], 'lab');
      if (db === 'expedientes') await query(db, `EXEC sys.sp_addextendedproperty @name=N'MS_Description',@value=${literal(field.description)},@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=${literal(table)},@level2type=N'COLUMN',@level2name=${literal(field.name)}`, [], 'lab');
      if (field.ref && db !== 'tributos') await query(db, `CREATE INDEX ${quote(db, `ix_${table}_${field.name}`)} ON ${quote(db, table)}(${quote(db, field.name)})`, [], 'lab');
    }
    for (const row of fixtures()[db][table]) {
      const keys = Object.keys(row);
      await query(db, `INSERT INTO ${quote(db, table)}(${keys.map(key => quote(db, key)).join(',')}) VALUES(${keys.map((_, offset) => `@p${offset}`).join(',')})`, Object.values(row), 'lab');
    }
  }
  for (const [name, select] of Object.entries(views[db])) await query(db, `CREATE VIEW ${quote(db, name)} AS ${select}`, [], 'lab');
  if (db === 'padron') await query(db, 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO openmetadata_reader', [], 'admin');
  for (const [table, expected] of Object.entries(initialCounts[db])) {
    const [row] = await query(db, `SELECT COUNT(*) AS total FROM ${quote(db, table)}`, [], 'reader');
    if (Number(row.total) !== expected) throw new Error(`Conteo inesperado en ${db}.${table}`);
  }
  for (const view of Object.keys(views[db])) await query(db, `SELECT * FROM ${quote(db, view)}`, [], 'reader');
  await query(db, "UPDATE _lab_state SET status='ready' WHERE id=1", [], 'lab');
  console.log(`${db}: conjunto inicial verificado`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { for (const db of databaseIds) await seedDatabase(db); } catch (error) { console.error(error instanceof Error ? error.message : 'Fallo de inicializacion'); process.exitCode = 1; }
  finally { await closePools(); }
}