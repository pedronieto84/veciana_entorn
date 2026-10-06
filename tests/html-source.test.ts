import { describe, it, expect, vi } from 'vitest';
import { extractTable, parseTable, selectRows } from '../server/html-source.js';
import { createSchoolSite, initialEnrollments } from '../server/escoles.js';
import { createSources } from '../server/sources.js';
import * as explorer from '../server/explorer.js';
import * as scenarios from '../server/scenarios.js';
import { databaseIds } from '../server/fixtures.js';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const html = (headers: string[], rows: string[][]) => `<table id="matriculas"><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
describe('extraccion de una tabla HTML', () => {
  it('lee entidades, vacios y codigos sin perder ceros', () => {
    const data = parseTable(html(['Id', 'Nombre', 'Codigo escuela', 'Curso'], [['1', 'Laia &amp; Pau', '0012', '']]));
    expect(data.rows[0]).toEqual({ id: '1', nombre: 'Laia & Pau', codigo_escuela: '0012', curso: '' });
    expect(data.columns[2].type).toBe('texto observado');
    expect(data.columns[0].primary_key).toBe(false);
    expect(data.columns[0].nullable).toBeNull();
  });
  it('detecta columnas nuevas y encabezados renombrados desde el HTML', () => {
    const initial = parseTable(html(['Id', 'Curso'], [['1', '3 Primaria']]));
    const changed = parseTable(html(['Id', 'Nivel', 'Beca'], [['1', '3 Primaria', 'No']]));
    expect(initial.columns.map(column => column.name)).toEqual(['id', 'curso']);
    expect(changed.columns.map(column => column.name)).toEqual(['id', 'nivel', 'beca']);
  });
  it('admite tabla vacia pero rechaza estructura ausente, ambigua o incoherente', () => {
    expect(parseTable(html(['Id'], [])).rows).toEqual([]);
    expect(() => parseTable('<html></html>')).toThrow('tabla');
    expect(() => parseTable(html(['Id', 'ID'], []))).toThrow('duplicados');
    expect(() => parseTable(html(['Id', 'Curso'], [['1']]))).toThrow('fila');
    expect(() => parseTable(html(['Id'], []).replace('<th>', '<th colspan="2">'))).toThrow('combinadas');
  });
  it('busca, ordena y pagina sin modificar el snapshot', () => {
    const data = parseTable(html(['Id', 'Nombre'], [['2', 'Pau'], ['10', 'Laia'], ['1', 'Pau']]));
    expect(selectRows(data, { sort: 'id', size: '1', page: '2' }).rows[0].id).toBe('2');
    expect(selectRows(data, { search: 'pau', direction: 'desc' }).rows.map(row => row.id)).toEqual(['2', '1']);
    expect(selectRows(data, { search: '#10' }).total).toBe(1);
    expect(data.rows[0].id).toBe('2');
  });
});
describe('web sintetica Escoles', () => {
  it('publica HTML accesible, fixtures coherentes y cambios persistentes e idempotentes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'escoles-'));
    const site = await createSchoolSite(join(directory, 'state.json'));
    try {
      expect(initialEnrollments()).toHaveLength(20);
      expect(initialEnrollments().every(row => Number(row.ciudadano_id) >= 81)).toBe(true);
      const response = await site.app.inject('/');
      expect(response.headers['content-type']).toContain('text/html');
      expect(parseTable(response.body).rows).toHaveLength(20);
      const requestId = randomUUID();
      expect((await site.run('insert', requestId)).after.count).toBe(25);
      expect((await site.run('insert', requestId)).alreadyApplied).toBe(true);
      await expect(site.run('reset', requestId)).rejects.toThrow('Identificador');
      await site.run('rename-column', randomUUID());
      await site.run('add-column', randomUUID());
      const reloaded = await createSchoolSite(join(directory, 'state.json'));
      try {
        const data = parseTable(reloaded.render());
        expect(data.rows).toHaveLength(25);
        expect(data.columns.map(column => column.name)).toContain('nivel');
        expect(data.columns.map(column => column.name)).toContain('beca');
        expect(data.columns.map(column => column.name)).not.toContain('curso');
        await reloaded.run('reset', randomUUID());
        expect(parseTable(reloaded.render()).rows).toEqual(initialEnrollments());
        expect(reloaded.history()).toHaveLength(4);
      } finally { await reloaded.app.close(); }
    } finally { await site.app.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('extrae por HTTP, detecta drift y mantiene cuatro fuentes sin ampliar las bases SQL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'escoles-http-'));
    const site = await createSchoolSite(join(directory, 'state.json'));
    const tableMock = vi.spyOn(explorer, 'tables').mockResolvedValue([{ name: 'tabla', kind: 'BASE TABLE', count: 1 }]);
    const resetMock = vi.spyOn(scenarios, 'resetAll').mockResolvedValue(databaseIds.map(db => ({ db, success: true, result: {} })));
    try {
      const url = await site.app.listen({ host: '127.0.0.1', port: 0 });
      const sources = createSources(site, url);
      const listed = await sources.list();
      expect(listed).toHaveLength(4);
      expect(databaseIds).toHaveLength(3);
      expect(listed.find(source => source.id === 'escoles')).toMatchObject({ type: 'html', status: 'online', capabilities: { indexes: false } });
      expect((await sources.rows('escoles', 'matriculas', {})).total).toBe(20);
      expect((await sources.quality('escoles')).rules.every(rule => rule.failed.length === 0)).toBe(true);
      await sources.run('escoles', 'rename-column', randomUUID());
      expect((await sources.schema('escoles', 'matriculas')).columns.map(column => column.name)).toContain('nivel');
      await sources.run('escoles', 'insert', randomUUID());
      expect((await extractTable(url)).rows).toHaveLength(25);
      await expect(sources.rows('escoles', 'otra', {})).rejects.toMatchObject({ statusCode: 404 });
      expect((await sources.reset(randomUUID())).map(result => result.db)).toEqual([...databaseIds, 'escoles']);
      expect((await extractTable(url)).rows).toHaveLength(20);
      await site.app.close();
      const unavailable = await sources.list();
      expect(unavailable.find(source => source.id === 'escoles')?.status).toBe('offline');
      expect(unavailable.filter(source => source.type === 'database').every(source => source.status === 'online')).toBe(true);
      await expect(sources.rows('escoles', 'matriculas', {})).rejects.toThrow('web no responde');
      expect((await sources.reset(randomUUID())).at(-1)).toMatchObject({ db: 'escoles', success: false });
    } finally { tableMock.mockRestore(); resetMock.mockRestore(); await site.app.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('limita altas y revierte cambios si la extraccion de comprobacion falla', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'escoles-limit-'));
    const site = await createSchoolSite(join(directory, 'state.json'));
    try {
      for (let batch = 0; batch < 10; batch++) await site.run('insert', randomUUID());
      await expect(site.run('insert', randomUUID())).rejects.toMatchObject({ statusCode: 409 });
      expect(parseTable(site.render()).rows).toHaveLength(70);
      let reads = 0;
      await expect(site.run('reset', randomUUID(), async () => {
        reads++;
        if (reads === 2) throw new Error('HTTP no disponible');
        return parseTable(site.render());
      })).rejects.toThrow('HTTP no disponible');
      expect(parseTable(site.render()).rows).toHaveLength(70);
      expect(site.history()).toHaveLength(10);
    } finally { await site.app.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('escapa contenido HTML y rechaza estado persistente malformado', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'escoles-validation-'));
    const file = join(directory, 'state.json');
    const { writeFile } = await import('node:fs/promises');
    try {
      await writeFile(file, JSON.stringify({ rows: [], operations: [] }));
      await expect(createSchoolSite(file)).rejects.toThrow('Estado');
      await rm(file);
      const site = await createSchoolSite(file);
      try { await site.run('update', randomUUID()); } finally { await site.app.close(); }
      const { readFile } = await import('node:fs/promises');
      const saved = JSON.parse(await readFile(file, 'utf8'));
      saved.rows[0].nombre = '<script>alert(1)</script>';
      await writeFile(file, JSON.stringify(saved));
      const loaded = await createSchoolSite(file);
      try {
        expect(loaded.render()).not.toContain('<script>');
        expect(parseTable(loaded.render()).rows[0].nombre).toBe('<script>alert(1)</script>');
      } finally { await loaded.app.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
describe('fallos del transporte HTML', () => {
  it('rechaza HTTP fallido, JSON, redirecciones, exceso de bytes y timeout', async () => {
    const app = Fastify();
    app.get('/json', () => ({ rows: [] }));
    app.get('/redirect', (_, reply) => reply.redirect('/json'));
    app.get('/large', (_, reply) => reply.type('text/html').send('x'.repeat(1024 * 1024 + 1)));
    app.get('/missing', (_, reply) => reply.type('text/html').send('<html></html>'));
    app.get('/slow', async (_, reply) => { await new Promise(resolve => setTimeout(resolve, 80)); return reply.type('text/html').send(html(['Id'], [])); });
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      await expect(extractTable(`${url}/404`)).rejects.toThrow('HTTP 404');
      await expect(extractTable(`${url}/json`)).rejects.toThrow('contenido no HTML');
      await expect(extractTable(`${url}/redirect`)).rejects.toThrow('no responde');
      await expect(extractTable(`${url}/large`)).rejects.toThrow('demasiado grande');
      await expect(extractTable(`${url}/missing`)).rejects.toThrow('tabla');
      await expect(extractTable(`${url}/slow`, '#matriculas', 5)).rejects.toThrow('no responde');
    } finally { await app.close(); }
  });
});