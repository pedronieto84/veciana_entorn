import { describe, it, expect } from 'vitest';
import { fixtures, dni, validDni, initialCounts } from '../server/fixtures.js';
describe('conjunto municipal reproducible', () => {
  it('respeta los limites acordados', () => {
    expect(initialCounts.padron.ciudadanos).toBe(100);
    expect(Object.values(initialCounts.tributos).reduce((total, count) => total + count, 0)).toBe(200);
    expect(Object.values(initialCounts.expedientes).reduce((total, count) => total + count, 0)).toBe(105);
    expect(fixtures()).toEqual(fixtures());
  });
  it('genera letras de control correctas y solo los errores deliberados', () => {
    expect(dni(12345678)).toBe('12345678Z');
    const citizens = fixtures().padron.ciudadanos;
    expect(citizens.filter(row => row.dni === null).map(row => row.id)).toEqual([3, 7, 11, ...Array.from({ length: 20 }, (_, offset) => 81 + offset)]);
    expect(citizens.filter(row => row.dni === '').map(row => row.id)).toEqual([13, 17]);
    expect(citizens.filter(row => row.dni && !validDni(row.dni)).map(row => row.id)).toEqual([19, 23, 29]);
    const docs = citizens.filter(row => row.dni && validDni(row.dni)).map(row => row.dni);
    expect(docs.length - new Set(docs).size).toBe(1);
  });
  it('mantiene referencias locales y externas validas', () => {
    const data = fixtures();
    const foreignKeys = [
      ['padron', 'domicilios', 'calle_id', 'calles'], ['padron', 'hogares', 'domicilio_id', 'domicilios'],
      ['padron', 'ciudadanos', 'hogar_id', 'hogares'], ['padron', 'movimientos_padron', 'ciudadano_id', 'ciudadanos'],
      ['tributos', 'objetos_tributarios', 'contribuyente_id', 'contribuyentes'], ['tributos', 'objetos_tributarios', 'concepto_id', 'conceptos'],
      ['tributos', 'liquidaciones', 'objeto_id', 'objetos_tributarios'], ['tributos', 'pagos', 'liquidacion_id', 'liquidaciones'],
      ['tributos', 'bonificaciones', 'objeto_id', 'objetos_tributarios'], ['expedientes', 'expedientes', 'tipo_id', 'tipos_expediente'],
      ['expedientes', 'actuaciones', 'expediente_id', 'expedientes'], ['expedientes', 'documentos', 'expediente_id', 'expedientes']
    ] as const;
    for (const [db, table, column, parent] of foreignKeys) {
      const ids = new Set(data[db][parent].map(row => row.id));
      expect(data[db][table].every(row => ids.has(Number(row[column])))).toBe(true);
    }
    for (const row of [...data.tributos.contribuyentes, ...data.expedientes.expedientes]) expect(data.padron.ciudadanos.some(citizen => citizen.id === row.ciudadano_id)).toBe(true);
  });
  it('solo introduce un importe negativo y concilia pagos y estados', () => {
    const data = fixtures().tributos;
    expect(data.liquidaciones.filter(row => Number(row.importe) < 0).map(row => row.id)).toEqual([4]);
    for (const row of data.liquidaciones) {
      const paid = data.pagos.filter(payment => payment.liquidacion_id === row.id).reduce((sum, payment) => sum + Number(payment.importe), 0);
      expect(row.estado).toBe(paid === 0 ? 'PENDIENTE' : paid === row.importe ? 'PAGADO' : 'PARCIAL');
    }
  });
});