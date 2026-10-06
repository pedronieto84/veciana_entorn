import 'dotenv/config';
import pg from 'pg';
import mysql from 'mysql2/promise';
import sql from 'mssql';
import { databaseIds, type DatabaseId } from './fixtures.js';
export type Role = 'admin' | 'lab' | 'reader';
export type Row = Record<string, any>;
export const secrets = {
  pgAdmin: process.env.PG_ADMIN_PASSWORD!, mysqlAdmin: process.env.MYSQL_ADMIN_PASSWORD!, sqlAdmin: process.env.MSSQL_ADMIN_PASSWORD!,
  lab: process.env.LAB_PASSWORD!, reader: process.env.READER_PASSWORD!
};
export const definitions = {
  padron: { label: 'Padron', engine: 'PostgreSQL 16', schema: 'public', port: Number(process.env.PG_PORT || 55432), internalPort: 5432, host: process.env.PG_HOST || '127.0.0.1', admin: 'postgres', adminPassword: secrets.pgAdmin },
  tributos: { label: 'Tributos', engine: 'MySQL 8.4', schema: 'tributos', port: Number(process.env.MYSQL_PORT || 53306), internalPort: 3306, host: process.env.MYSQL_HOST || '127.0.0.1', admin: 'root', adminPassword: secrets.mysqlAdmin },
  expedientes: { label: 'Expedientes', engine: 'SQL Server 2022', schema: 'dbo', port: Number(process.env.MSSQL_PORT || 51433), internalPort: 1433, host: process.env.MSSQL_HOST || '127.0.0.1', admin: 'sa', adminPassword: secrets.sqlAdmin }
};
const pools = new Map<string, Promise<any>>();
export const quote = (db: DatabaseId, name: string): string => db === 'padron' ? `"${name.replaceAll('"', '""')}"` : db === 'tributos' ? `\`${name.replaceAll('`', '``')}\`` : `[${name.replaceAll(']', ']]')}]`;
export const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
async function pool(db: DatabaseId, role: Role, master = false) {
  const key = `${db}:${role}:${master}`;
  if (!pools.has(key)) {
    const def = definitions[db];
    const user = role === 'admin' ? def.admin : role === 'lab' ? 'veciana_lab' : 'openmetadata_reader';
    const password = role === 'admin' ? def.adminPassword : secrets[role];
    const port = def.host === '127.0.0.1' ? def.port : def.internalPort;
    const connect = async () => {
      if (db === 'padron') return new pg.Pool({ host: def.host, port, user, password, database: db, max: 5, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
      if (db === 'tributos') return mysql.createPool({ host: def.host, port, user, password, database: db, connectionLimit: 5, multipleStatements: true, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 10000 });
      return new sql.ConnectionPool({ server: def.host, port, user, password, database: master ? 'master' : db, requestTimeout: 15000,
        options: { encrypt: true, trustServerCertificate: true }, pool: { max: 5, min: 0 } }).connect();
    };
    pools.set(key, connect().catch(error => { pools.delete(key); throw error; }));
  }
  return pools.get(key)!;
}
export async function query(db: DatabaseId, text: string, values: unknown[] = [], role: Role = 'reader', master = false): Promise<Row[]> {
  const client = await pool(db, role, master);
  return execute(db, client, text, values);
}
export type Executor = (text: string, values?: unknown[]) => Promise<Row[]>;
async function execute(db: DatabaseId, client: any, text: string, values: unknown[] = []): Promise<Row[]> {
  if (db === 'padron') {
    const result = await client.query(text.replace(/@p(\d+)/g, (_, index) => `$${Number(index) + 1}`), values);
    return Array.isArray(result) ? result.at(-1).rows : result.rows;
  }
  if (db === 'tributos') {
    const ordered: unknown[] = [];
    const prepared = text.replace(/@p(\d+)/g, (_, index) => { ordered.push(values[Number(index)]); return '?'; });
    const [rows] = await client.query({ sql: prepared, values: ordered, timeout: 15000 });
    return Array.isArray(rows) ? rows : [];
  }
  const request = new sql.Request(client);
  values.forEach((value, index) => request.input(`p${index}`, value));
  return (await request.query(text)).recordset || [];
}
export async function transaction<T>(db: DatabaseId, work: (run: Executor) => Promise<T>): Promise<T> {
  const parent = await pool(db, 'lab');
  const client = db === 'padron' ? await parent.connect() : db === 'tributos' ? await parent.getConnection() : new sql.Transaction(parent);
  try {
    if (db === 'padron') await client.query('BEGIN');
    else if (db === 'tributos') await client.beginTransaction();
    else await client.begin();
    const result = await work((text, values) => execute(db, client, text, values));
    if (db === 'padron') await client.query('COMMIT'); else await client.commit();
    return result;
  } catch (error) {
    try { if (db === 'padron') await client.query('ROLLBACK'); else await client.rollback(); } catch {}
    throw error;
  } finally { if (db !== 'expedientes') client.release(); }
}
export async function closePools() {
  for (const [key, promise] of pools) {
    try { const client = await promise; if (key.startsWith('expedientes')) await client.close(); else await client.end(); } catch {}
  }
  pools.clear();
}
export function databaseId(value: string): DatabaseId {
  if (!databaseIds.includes(value as DatabaseId)) throw Object.assign(new Error('Base de datos desconocida'), { statusCode: 404 });
  return value as DatabaseId;
}