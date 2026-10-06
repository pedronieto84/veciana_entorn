import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { query, closePools } from '../server/databases.js';
import { tables, schema, rows, relationships, quality } from '../server/explorer.js';
import { databaseIds, initialCounts } from '../server/fixtures.js';
import { seedDatabase } from '../server/seed.js';
import { runScenario, target, resetAll } from '../server/scenarios.js';
try {
  for (const db of databaseIds) {
    await seedDatabase(db);
    const found = await tables(db);
    for (const [name, expected] of Object.entries(initialCounts[db])) {
      assert.equal(found.find(table => table.name === name)?.count, expected);
      const meta = await schema(db, name);
      assert.ok(meta.columns.length);
      assert.ok(meta.columns.every(column => column.description));
      assert.ok(meta.columns.some(column => column.primary_key));
      assert.ok(meta.indexes.length);
      assert.equal((await rows(db, name)).rows.length, Math.min(expected, 25));
      assert.equal((await rows(db, name, { search: "'; DROP TABLE ciudadanos;--" })).total, 0);
    }
    assert.ok((await relationships(db)).length);
    assert.ok((await quality(db)).rules.every(rule => rule.matchesExpected));
    const name = Object.keys(initialCounts[db])[0];
    await assert.rejects(query(db, `DELETE FROM ${name} WHERE id=-1`, [], 'reader'));
    await assert.rejects(query(db, `ALTER TABLE ${name} ADD forbidden_column INT`, [], 'reader'));
    await assert.rejects(rows(db, '_lab_state'));
    if (db === 'padron') await query(db, 'SELECT query,calls FROM pg_stat_statements LIMIT 1');
    if (db === 'tributos') await query(db, 'SELECT argument FROM mysql.general_log LIMIT 1');
    if (db === 'expedientes') await query(db, 'SELECT TOP 1 query_sql_text FROM sys.query_store_query_text');
    console.log(`${db}: conteos, metadatos, calidad y permisos OK`);
    const requestId = randomUUID();
    const insert = await runScenario(db, 'insert', requestId);
    assert.equal(insert.after.count, initialCounts[db][target[db]] + 5);
    assert.deepEqual(await runScenario(db, 'insert', requestId), insert);
    await seedDatabase(db);
    assert.equal((await tables(db)).find(table => table.name === target[db])?.count, insert.after.count);
    const concurrent = await Promise.allSettled([runScenario(db, 'update', randomUUID()), runScenario(db, 'update', randomUUID())]);
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
    const add = await runScenario(db, 'add-column', randomUUID());
    assert.ok(add.after.columns.some((column: any) => column.name === 'canal_origen'));
    assert.equal((await runScenario(db, 'add-column', randomUUID())).alreadyApplied, true);
    const changed = await runScenario(db, 'change-type', randomUUID());
    assert.ok(changed.after.columns.some((column: any) => /^(text|bigint)$/i.test(column.type)));
    assert.equal((await runScenario(db, 'change-type', randomUUID())).alreadyApplied, true);
    await runScenario(db, 'workload', randomUUID());
    for (let batch = 1; batch < 10; batch++) await runScenario(db, 'insert', randomUUID());
    await assert.rejects(runScenario(db, 'insert', randomUUID()), /Limite de 10 lotes/);
    await assert.rejects(runScenario(db, 'insert', randomUUID()), /interrumpida/);
    await runScenario(db, 'reset', randomUUID());
    for (const [name, expected] of Object.entries(initialCounts[db])) assert.equal((await tables(db)).find(table => table.name === name)?.count, expected);
    assert.ok((await quality(db)).rules.every(rule => rule.matchesExpected));
    assert.ok(!(await schema(db, target[db])).columns.some(column => column.name === 'canal_origen'));
    const interrupted = randomUUID();
    await query(db, "INSERT INTO _lab_operations(request_id,action,status,created_at) VALUES(@p0,'add-column','pending',@p1)", [interrupted, new Date().toISOString()], 'lab');
    await assert.rejects(runScenario(db, 'insert', randomUUID()), /interrumpida/);
    await runScenario(db, 'reset', randomUUID());
    console.log(`${db}: insercion, concurrencia, idempotencia, DDL, limites y recuperacion OK`);
  }
  const retained = new Map();
  for (const db of databaseIds) {
    const requestId = randomUUID();
    retained.set(db, { requestId, result: await runScenario(db, 'insert', requestId) });
  }
  if (process.argv.includes('--persistence')) {
    execFileSync('docker', ['compose', 'restart', 'web'], { stdio: 'inherit' });
    execFileSync('docker', ['compose', 'run', '--rm', 'init'], { stdio: 'inherit' });
  }
  for (const db of databaseIds) {
    const { requestId, result } = retained.get(db);
    await seedDatabase(db);
    assert.equal((await tables(db)).find(table => table.name === target[db])?.count, initialCounts[db][target[db]] + 5);
    assert.deepEqual(await runScenario(db, 'insert', requestId), result);
  }
  console.log('Persistencia: inicializacion repetida conserva cambios e idempotencia');
  assert.ok((await resetAll(randomUUID())).every(item => item.success));
} finally { await closePools(); }