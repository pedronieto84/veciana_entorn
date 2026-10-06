import { definitions, query, quote, type Row } from './databases.js';
import { anomalies, validDni, referenceDate, type DatabaseId } from './fixtures.js';
export async function tables(db: DatabaseId) {
  const schema = definitions[db].schema;
  const found = await query(db, "SELECT table_name AS name,table_type AS kind FROM information_schema.tables WHERE table_schema=@p0 AND LEFT(table_name,1)<>'_' ORDER BY table_name", [schema]);
  return Promise.all(found.map(async row => {
    const [count] = await query(db, `SELECT COUNT(*) AS total FROM ${quote(db, row.name)}`);
    return { name: String(row.name), kind: String(row.kind), count: Number(count.total) };
  }));
}
export async function assertTable(db: DatabaseId, name: string) {
  const exists = await tables(db);
  if (!exists.some(table => table.name === name)) throw Object.assign(new Error('Tabla desconocida'), { statusCode: 404 });
}
export async function columns(db: DatabaseId, table: string): Promise<Row[]> {
  if (db === 'padron') return query(db, `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,NOT a.attnotnull AS nullable,
    COALESCE(col_description(c.oid,a.attnum),'') AS description,
    EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)) AS primary_key
    FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname='public' AND c.relname=@p0 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
  if (db === 'tributos') return query(db, `SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,(IS_NULLABLE='YES') AS nullable,COLUMN_COMMENT AS description,(COLUMN_KEY='PRI') AS primary_key
    FROM information_schema.columns WHERE table_schema='tributos' AND table_name=@p0 ORDER BY ordinal_position`, [table]);
  return query(db, `SELECT c.name AS name,t.name + CASE WHEN t.name IN ('nvarchar','varchar') THEN '('+CASE WHEN c.max_length=-1 THEN 'max' ELSE CAST(c.max_length / CASE WHEN t.name='nvarchar' THEN 2 ELSE 1 END AS VARCHAR(10)) END + ')' WHEN t.name IN ('decimal','numeric') THEN '('+CAST(c.precision AS VARCHAR(10))+','+CAST(c.scale AS VARCHAR(10))+')' ELSE '' END AS type,
    c.is_nullable AS nullable,COALESCE(CAST(ep.value AS NVARCHAR(1000)),'') AS description,
    CAST(CASE WHEN EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON ic.object_id=i.object_id AND ic.index_id=i.index_id WHERE i.is_primary_key=1 AND ic.object_id=c.object_id AND ic.column_id=c.column_id) THEN 1 ELSE 0 END AS BIT) AS primary_key
    FROM sys.columns c JOIN sys.types t ON c.user_type_id=t.user_type_id LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.name='MS_Description'
    WHERE c.object_id=OBJECT_ID(@p0) ORDER BY c.column_id`, [`dbo.${table}`]);
}
export async function relationships(db: DatabaseId) {
  if (db === 'padron') return query(db, `SELECT child.relname AS child,a.attname AS column_name,parent.relname AS parent,pa.attname AS parent_column
    FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace JOIN pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_attribute a ON a.attrelid=child.oid AND a.attnum=fk.conkey[1] JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
    WHERE fk.contype='f' AND ns.nspname='public'`);
  if (db === 'tributos') return query(db, `SELECT table_name AS child,column_name,referenced_table_name AS parent,referenced_column_name AS parent_column FROM information_schema.key_column_usage WHERE table_schema='tributos' AND referenced_table_name IS NOT NULL`);
  return query(db, `SELECT OBJECT_NAME(f.parent_object_id) AS child,COL_NAME(f.parent_object_id,f.parent_column_id) AS column_name,OBJECT_NAME(f.referenced_object_id) AS parent,COL_NAME(f.referenced_object_id,f.referenced_column_id) AS parent_column FROM sys.foreign_key_columns f`);
}
export async function indexes(db: DatabaseId, table: string) {
  if (db === 'padron') return query(db, "SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename=@p0", [table]);
  if (db === 'tributos') return query(db, "SELECT index_name AS name,GROUP_CONCAT(column_name ORDER BY seq_in_index) AS definition FROM information_schema.statistics WHERE table_schema='tributos' AND table_name=@p0 GROUP BY index_name", [table]);
  return query(db, `SELECT i.name,i.type_desc AS definition,c.name AS column_name FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(@p0) ORDER BY i.name,ic.key_ordinal`, [`dbo.${table}`]);
}
export async function schema(db: DatabaseId, table: string) {
  await assertTable(db, table);
  return { columns: await columns(db, table), indexes: await indexes(db, table), relationships: (await relationships(db)).filter(row => row.child === table || row.parent === table) };
}
export async function rows(db: DatabaseId, table: string, options: { page?: string; size?: string; search?: string; sort?: string; direction?: string } = {}) {
  await assertTable(db, table);
  const fields = await columns(db, table);
  const page = Math.max(1, Math.min(10000, Number.parseInt(options.page || '1') || 1));
  const size = Math.max(1, Math.min(100, Number.parseInt(options.size || '25') || 25));
  const order = fields.some(field => field.name === options.sort) ? options.sort! : fields.find(field => field.primary_key)?.name || fields[0].name;
  const values: unknown[] = [];
  let where = '';
  if (/^#\d+$/.test(options.search || '') && fields.some(field => field.name === 'id')) {
    values.push(Number(options.search!.slice(1)));
    where = ` WHERE ${quote(db, 'id')}=@p0`;
  } else if (options.search) {
    values.push(`%${options.search.slice(0, 160).replace(/[=%_]/g, char => `=${char}`)}%`);
    where = ' WHERE ' + fields.map(field => {
      const cast = db === 'padron' ? `CAST(${quote(db, field.name)} AS TEXT)` : db === 'tributos' ? `CAST(${quote(db, field.name)} AS CHAR)` : `CAST(${quote(db, field.name)} AS NVARCHAR(4000))`;
      return `${cast} LIKE @p0 ESCAPE '='`;
    }).join(' OR ');
  }
  const [count] = await query(db, `SELECT COUNT(*) AS total FROM ${quote(db, table)}${where}`, values);
  const select = fields.map(field => {
    const name = quote(db, field.name);
    if (db === 'expedientes' && /decimal|numeric|bigint|^date$/i.test(field.type)) return `CONVERT(VARCHAR(100),${name},23) AS ${name}`;
    if (db === 'padron' && /^date$/i.test(field.type)) return `CAST(${name} AS TEXT) AS ${name}`;
    return name;
  }).join(',');
  const direction = options.direction === 'desc' ? 'DESC' : 'ASC';
  const offset = (page - 1) * size;
  const pagination = db === 'expedientes' ? `OFFSET ${offset} ROWS FETCH NEXT ${size} ROWS ONLY` : `LIMIT ${size} OFFSET ${offset}`;
  const data = await query(db, `SELECT ${select} FROM ${quote(db, table)}${where} ORDER BY ${quote(db, order)} ${direction}${order !== fields[0].name ? `,${quote(db, fields[0].name)} ASC` : ''} ${pagination}`, values);
  return { columns: fields, rows: data, total: Number(count.total), page, size };
}
function iso(value: unknown) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value); }
export async function quality(db: DatabaseId) {
  const cache = new Map<string, Row[]>();
  for (const item of anomalies[db]) if (!cache.has(item.table)) cache.set(item.table, await query(db, `SELECT * FROM ${quote(db, item.table)}`));
  const results = anomalies[db].map(item => {
    const all = cache.get(item.table)!;
    const failed = all.filter(row => {
      const value = row[item.column];
      switch (item.kind) {
        case 'null': return value === null && iso(row.fecha_nacimiento) <= '2008-10-06';
        case 'empty': return value === '';
        case 'dni': return Boolean(value) && !validDni(value);
        case 'duplicate': return Boolean(value) && all.filter(other => other[item.column] === value).length > 1;
        case 'email': return Boolean(value) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
        case 'future': return iso(value) > referenceDate;
        case 'negative': return Number(value) < 0;
        case 'dates': return value !== null && iso(value) < iso(row.fecha_apertura);
        default: return false;
      }
    }).map(row => Number(row.id));
    return { ...item, failed, matchesExpected: JSON.stringify([...failed].sort((a, b) => a - b)) === JSON.stringify([...item.ids].sort((a, b) => a - b)) };
  });
  return { source: 'Comprobaciones locales; no resultados de OpenMetadata', referenceDate, rules: results, legitimateMissingDocuments: db === 'padron' ? 20 : 0 };
}