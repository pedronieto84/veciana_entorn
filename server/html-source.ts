import { load } from 'cheerio';

export type HtmlRow = Record<string, string>;
export interface HtmlColumn { name: string; type: string; nullable: null; primary_key: false; description: string }
export type RowOptions = { page?: string; size?: string; search?: string; sort?: string; direction?: string };
export const htmlError = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode });
export function parseTable(html: string, selector = '#matriculas') {
  const document = load(html);
  const table = document(selector);
  if (table.length !== 1) throw htmlError('Escoles: no se encuentra una unica tabla de matriculas. Revisa el selector.');
  const headers = table.find('thead > tr');
  if (headers.length !== 1) throw htmlError('Escoles: encabezado HTML ausente o ambiguo.');
  const headings = headers.children('th').toArray().map(cell => document(cell).text().trim().replace(/\s+/g, ' '));
  const names = headings.map(heading => heading.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  if (!names.length || names.some(name => !name || ['__proto__', 'constructor', 'prototype'].includes(name)) || new Set(names).size !== names.length) throw htmlError('Escoles: nombres de columna vacios o duplicados.');
  if (table.find('[colspan], [rowspan]').length) throw htmlError('Escoles: celdas combinadas no soportadas.');
  const rows: HtmlRow[] = table.find('tbody > tr').toArray().map(element => {
    const cells = document(element).children('td');
    if (cells.length !== names.length) throw htmlError('Escoles: una fila no coincide con las columnas del encabezado.');
    return Object.fromEntries(names.map((name, index) => [name, document(cells[index]).text().trim().replace(/\s+/g, ' ')]));
  });
  const columns: HtmlColumn[] = names.map((name, index) => {
    const values = rows.map(row => row[name]).filter(Boolean);
    const integer = values.length > 0 && values.every(value => /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)));
    const date = values.length > 0 && values.every(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
    return { name, type: integer ? 'entero observado' : date ? 'fecha observada' : 'texto observado', nullable: null, primary_key: false, description: headings[index] };
  });
  return { columns, rows };
}
export async function extractTable(url: string, selector = '#matriculas', timeout = 5000) {
  const signal = AbortSignal.timeout(timeout);
  let response: Response;
  try { response = await fetch(url, { signal, redirect: 'error' }); }
  catch { throw htmlError('Escoles: la web no responde. Comprueba su puerto y vuelve a actualizar.'); }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    await response.body?.cancel();
    throw htmlError(`Escoles: respuesta HTTP ${response.status} o contenido no HTML.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw htmlError('Escoles: respuesta vacia.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > 1024 * 1024) { await reader.cancel(); throw htmlError('Escoles: HTML demasiado grande (maximo 1 MB).'); }
      chunks.push(next.value);
    }
  } catch (failure) {
    if (failure instanceof Error && 'statusCode' in failure) throw failure;
    throw htmlError('Escoles: descarga HTML interrumpida. Vuelve a actualizar.');
  } finally { reader.releaseLock(); }
  return { ...parseTable(Buffer.concat(chunks).toString('utf8'), selector), provenance: { url, selector, extractedAt: new Date().toISOString() } };
}
export function selectRows(snapshot: ReturnType<typeof parseTable>, options: RowOptions = {}) {
  const page = Math.max(1, Math.min(10000, Number.parseInt(options.page || '1') || 1));
  const size = Math.max(1, Math.min(100, Number.parseInt(options.size || '25') || 25));
  const search = (options.search || '').slice(0, 160).toLocaleLowerCase('es');
  const rows = snapshot.rows.filter(row => /^#\d+$/.test(search) ? row.id === search.slice(1) : Object.values(row).some(value => value.toLocaleLowerCase('es').includes(search)));
  const column = snapshot.columns.find(field => field.name === options.sort) || snapshot.columns[0];
  const multiplier = options.direction === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('es', { numeric: true });
  rows.sort((left, right) => multiplier * collator.compare(left[column.name], right[column.name]));
  return { ...snapshot, rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, size };
}