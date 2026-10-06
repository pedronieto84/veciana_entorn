export type RecordData = Record<string, string | number | null>;
export type DatabaseId = 'padron' | 'tributos' | 'expedientes';
export const databaseIds: DatabaseId[] = ['padron', 'tributos', 'expedientes'];
export const referenceDate = '2026-10-06';
export function dni(number: number): string {
  return `${String(number).padStart(8, '0')}${'TRWAGMYFPDXBNJZSQVHLCKE'[number % 23]}`;
}
export function validDni(value: unknown): boolean {
  return typeof value === 'string' && /^\d{8}[A-Z]$/.test(value) && dni(Number(value.slice(0, 8))) === value;
}
const names = ['Laia', 'Jordi', 'Marta', 'Pau', 'Nuria', 'Marc', 'Anna', 'Pol', 'Clara', 'Joan'];
const surnames = ['Soler', 'Vidal', 'Puig', 'Riera', 'Serra', 'Ferrer', 'Costa', 'Font', 'Roig', 'Bosch'];
export const anomalies = {
  padron: [
    { table: 'ciudadanos', column: 'dni', ids: [3, 7, 11], rule: 'documento_adulto_presente', description: 'DNI NULL en adultos', kind: 'null' },
    { table: 'ciudadanos', column: 'dni', ids: [13, 17], rule: 'documento_no_vacio', description: 'DNI cadena vacia', kind: 'empty' },
    { table: 'ciudadanos', column: 'dni', ids: [19, 23, 29], rule: 'dni_valido', description: 'Dos formatos incorrectos y una letra de control incorrecta', kind: 'dni' },
    { table: 'ciudadanos', column: 'dni', ids: [31, 32], rule: 'dni_unico', description: 'Dos ciudadanos comparten DNI', kind: 'duplicate' },
    { table: 'ciudadanos', column: 'email', ids: [37, 41], rule: 'email_valido', description: 'Correo malformado', kind: 'email' },
    { table: 'ciudadanos', column: 'fecha_nacimiento', ids: [43], rule: 'nacimiento_no_futuro', description: 'Nacimiento futuro', kind: 'future' }
  ],
  tributos: [{ table: 'liquidaciones', column: 'importe', ids: [4], rule: 'importe_no_negativo', description: 'Liquidacion con importe negativo', kind: 'negative' }],
  expedientes: [{ table: 'expedientes', column: 'fecha_cierre', ids: [6], rule: 'cierre_posterior_apertura', description: 'Cierre anterior a apertura', kind: 'dates' }]
};
export function fixtures(): Record<DatabaseId, Record<string, RecordData[]>> {
  const citizens = Array.from({ length: 100 }, (_, offset) => {
    const id = offset + 1;
    const minor = id > 80;
    return { id, nombre: names[offset % 10], apellidos: `${surnames[Math.floor(offset / 10)]} ${surnames[(offset + 3) % 10]}`,
      dni: minor ? null : dni(40000000 + id), fecha_nacimiento: `${minor ? 2012 + id % 8 : 1948 + id % 49}-05-${String(1 + id % 27).padStart(2, '0')}`,
      nacionalidad: 'ESP', hogar_id: 1 + offset % 40, fecha_alta: '2025-01-15',
      email: `persona${id}@example.invalid`, telefono: `600${String(id).padStart(6, '0')}`, situacion: 'ACTIVO' };
  });
  for (const id of [3, 7, 11]) citizens[id - 1].dni = null;
  for (const id of [13, 17]) citizens[id - 1].dni = '';
  citizens[18].dni = 'SIN-DOCUMENTO'; citizens[22].dni = '123';
  citizens[28].dni = dni(40000029).slice(0, 8) + (dni(40000029).endsWith('A') ? 'B' : 'A');
  citizens[31].dni = citizens[30].dni;
  citizens[36].email = 'correo-sin-arroba'; citizens[40].email = 'persona41@';
  citizens[42].fecha_nacimiento = '2030-05-01';
  const concepts = ['IBI', 'IVTM', 'RESIDUOS', 'TASA'];
  const liquidations = Array.from({ length: 60 }, (_, offset) => ({ id: offset + 1, objeto_id: 1 + offset % 36,
    ejercicio: 2026, referencia: `LIQ-2026-${String(offset + 1).padStart(4, '0')}`, importe: offset === 3 ? -25 : 100 + offset * 5,
    fecha_emision: '2026-02-01', fecha_vencimiento: '2026-06-30', estado: offset === 3 || offset >= 45 ? 'PENDIENTE' : offset % 3 === 0 ? 'PARCIAL' : 'PAGADO' }));
  const payments = Array.from({ length: 45 }, (_, offset) => {
    const liquidation = liquidations[offset === 3 ? 45 : offset];
    if (offset === 3) liquidation.estado = 'PAGADO';
    return { id: offset + 1, liquidacion_id: liquidation.id, importe: offset % 3 === 0 && offset !== 3 ? liquidation.importe / 2 : liquidation.importe,
      fecha_pago: '2026-04-10', medio: ['DOMICILIACION', 'TRANSFERENCIA', 'TARJETA'][offset % 3] };
  });
  return {
    padron: {
      calles: ['Carrer Major', 'Carrer del Forn', 'Cami de les Masies', 'Placa de la Vila', 'Carrer de les Escoles', 'Cami del Bosc'].map((nombre, offset) => ({ id: offset + 1, nombre, nucleo: offset % 2 ? 'Sant Pere' : 'Veciana' })),
      domicilios: Array.from({ length: 40 }, (_, offset) => ({ id: offset + 1, calle_id: 1 + offset % 6, numero: String(1 + offset), piso: offset % 3 ? 'BAIXOS' : '1', codigo_postal: '08289', referencia_catastral: `SIM${String(offset + 1).padStart(17, '0')}` })),
      hogares: Array.from({ length: 40 }, (_, offset) => ({ id: offset + 1, domicilio_id: offset + 1, fecha_apertura: '2025-01-15' })),
      ciudadanos: citizens,
      movimientos_padron: Array.from({ length: 20 }, (_, offset) => ({ id: offset + 1, ciudadano_id: offset + 1, tipo: 'ALTA', fecha: '2025-01-15', motivo: 'Alta inicial del conjunto sintetico' }))
    },
    tributos: {
      contribuyentes: citizens.slice(0, 40).map(citizen => ({ id: citizen.id, ciudadano_id: citizen.id, nombre_fiscal: `${citizen.nombre} ${citizen.apellidos}`, nif: citizen.dni, email_notificacion: citizen.email })),
      conceptos: concepts.map((codigo, offset) => ({ id: offset + 1, codigo, descripcion: ['Impuesto bienes inmuebles', 'Impuesto vehiculos', 'Tasa recogida residuos', 'Tasa tramite administrativo'][offset] })),
      objetos_tributarios: Array.from({ length: 36 }, (_, offset) => ({ id: offset + 1, contribuyente_id: offset + 1, concepto_id: 1 + offset % 4, referencia: `OBJ-SIM-${offset + 1}`, descripcion: ['Vivienda rural', 'Vehiculo turismo', 'Servicio residuos', 'Solicitud licencia'][offset % 4] })),
      liquidaciones: liquidations, pagos: payments,
      bonificaciones: Array.from({ length: 15 }, (_, offset) => ({ id: offset + 1, objeto_id: offset + 1, porcentaje: offset % 2 ? 25 : 50, motivo: offset % 2 ? 'Eficiencia energetica' : 'Familia numerosa', ejercicio: 2026 }))
    },
    expedientes: {
      tipos_expediente: ['Licencia de obra', 'Instancia general', 'Certificado padron', 'Ayuda social', 'Ocupacion via publica'].map((nombre, offset) => ({ id: offset + 1, nombre, plazo_dias: [90, 30, 10, 60, 30][offset] })),
      expedientes: Array.from({ length: 30 }, (_, offset) => ({ id: offset + 1, codigo: `EXP-2026-${String(offset + 1).padStart(4, '0')}`, ciudadano_id: offset + 1, tipo_id: 1 + offset % 5,
        asunto: `Solicitud sintetica ${offset + 1}`, estado: offset < 10 ? 'CERRADO' : offset < 20 ? 'EN_TRAMITE' : 'REGISTRADO',
        fecha_apertura: '2026-03-01', fecha_cierre: offset === 5 ? '2026-02-01' : offset < 10 ? '2026-05-10' : null, prioridad: 1 + offset % 3, unidad: offset % 2 ? 'Secretaria' : 'Urbanismo' })),
      actuaciones: Array.from({ length: 45 }, (_, offset) => ({ id: offset + 1, expediente_id: 1 + offset % 30, fecha: '2026-03-02', tipo: offset < 30 ? 'REGISTRO' : 'REVISION', descripcion: 'Actuacion administrativa simulada', responsable: 'empleado_simulado' })),
      documentos: Array.from({ length: 25 }, (_, offset) => ({ id: offset + 1, expediente_id: offset + 1, nombre: `solicitud_${offset + 1}.pdf`, tipo_mime: 'application/pdf', fecha_registro: '2026-03-01', tamano_bytes: 20000 + offset * 125 }))
    }
  };
}
export const initialCounts = Object.fromEntries(databaseIds.map(id => [id, Object.fromEntries(Object.entries(fixtures()[id]).map(([table, rows]) => [table, rows.length]))])) as Record<DatabaseId, Record<string, number>>;