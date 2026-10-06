import type { DatabaseId } from './fixtures.js';
export interface Field { name: string; type: 'int' | 'date' | 'money' | 'text' | 'string'; length?: number; nullable?: boolean; ref?: string; description: string }
const field = (name: string, type: Field['type'], description: string, options: Partial<Field> = {}): Field => ({ name, type, description, ...options });
const id = field('id', 'int', 'Identificador interno sintetico; clave primaria');
const ref = (name: string, table: string) => field(name, 'int', `Referencia a ${table}.id`, { ref: table });
const external = field('ciudadano_id', 'int', 'Relacion logica con padron.public.ciudadanos.id; sin FK entre motores');
const str = (name: string, description: string, length = 120, nullable = false) => field(name, 'string', description, { length, nullable });
const date = (name: string, description: string, nullable = false) => field(name, 'date', description, { nullable });
export const model: Record<DatabaseId, Record<string, { description: string; fields: Field[] }>> = {
  padron: {
    calles: { description: 'Vias y nucleos del municipio ficticio', fields: [id, str('nombre', 'Nombre de via'), str('nucleo', 'Nucleo de poblacion')] },
    domicilios: { description: 'Direcciones de viviendas sinteticas', fields: [id, ref('calle_id', 'calles'), str('numero', 'Numero de portal', 12), str('piso', 'Piso o planta', 20), str('codigo_postal', 'Codigo postal', 5), str('referencia_catastral', 'Referencia sintetica; no usar como catastro real', 20)] },
    hogares: { description: 'Unidades de convivencia', fields: [id, ref('domicilio_id', 'domicilios'), date('fecha_apertura', 'Fecha de apertura del hogar')] },
    ciudadanos: { description: '100 habitantes iniciales ficticios; contiene defectos deliberados de calidad', fields: [id, str('nombre', 'Nombre sintetico'), str('apellidos', 'Apellidos sinteticos'), str('dni', 'Documento personal simulado; admite NULL, vacios y defectos para pruebas', 20, true), date('fecha_nacimiento', 'Fecha de nacimiento simulada'), str('nacionalidad', 'Codigo ISO de nacionalidad', 3), ref('hogar_id', 'hogares'), date('fecha_alta', 'Fecha de alta padronal'), str('email', 'Correo simulado en example.invalid', 180, true), str('telefono', 'Telefono simulado', 20, true), str('situacion', 'Situacion padronal', 20)] },
    movimientos_padron: { description: 'Historial de movimientos padronales', fields: [id, ref('ciudadano_id', 'ciudadanos'), str('tipo', 'Tipo de movimiento', 20), date('fecha', 'Fecha del movimiento'), str('motivo', 'Motivo administrativo')] }
  },
  tributos: {
    contribuyentes: { description: '40 contribuyentes adultos del padron; replica fiscal parcial', fields: [id, external, str('nombre_fiscal', 'Nombre del obligado tributario'), str('nif', 'Documento replicado del padron; hereda sus defectos', 20, true), str('email_notificacion', 'Correo para notificaciones simuladas', 180, true)] },
    conceptos: { description: 'Catalogo de tributos y tasas', fields: [id, str('codigo', 'Codigo de concepto', 20), str('descripcion', 'Denominacion del tributo')] },
    objetos_tributarios: { description: 'Bienes y servicios sujetos a tributo', fields: [id, ref('contribuyente_id', 'contribuyentes'), ref('concepto_id', 'conceptos'), str('referencia', 'Identificador sintetico del objeto', 40), str('descripcion', 'Bien o servicio')] },
    liquidaciones: { description: 'Liquidaciones del ejercicio; id 4 tiene importe negativo deliberado', fields: [id, ref('objeto_id', 'objetos_tributarios'), field('ejercicio', 'int', 'Ejercicio tributario'), str('referencia', 'Referencia de liquidacion', 40), field('importe', 'money', 'Euros; DECIMAL exacto, contiene un defecto negativo'), date('fecha_emision', 'Fecha de emision'), date('fecha_vencimiento', 'Fecha de vencimiento'), str('estado', 'PENDIENTE, PARCIAL o PAGADO', 20)] },
    pagos: { description: 'Pagos conciliados con las liquidaciones; admite pagos parciales', fields: [id, ref('liquidacion_id', 'liquidaciones'), field('importe', 'money', 'Euros pagados'), date('fecha_pago', 'Fecha de cobro'), str('medio', 'Medio de pago', 30)] },
    bonificaciones: { description: 'Bonificaciones concedidas por ejercicio; importes ya netos en liquidaciones', fields: [id, ref('objeto_id', 'objetos_tributarios'), field('porcentaje', 'int', 'Porcentaje concedido'), str('motivo', 'Causa de bonificacion'), field('ejercicio', 'int', 'Ejercicio de concesion')] }
  },
  expedientes: {
    tipos_expediente: { description: 'Catalogo de procedimientos administrativos', fields: [id, str('nombre', 'Tipo de procedimiento'), field('plazo_dias', 'int', 'Plazo orientativo en dias')] },
    expedientes: { description: 'Expedientes ficticios; id 6 tiene fecha de cierre incoherente', fields: [id, str('codigo', 'Numero del expediente', 40), external, ref('tipo_id', 'tipos_expediente'), str('asunto', 'Asunto de solicitud'), str('estado', 'Estado de tramitacion', 20), date('fecha_apertura', 'Fecha de apertura'), date('fecha_cierre', 'Fecha de cierre; contiene un defecto cronologico', true), field('prioridad', 'int', 'Prioridad numerica; escenario INT a BIGINT'), str('unidad', 'Unidad responsable', 50)] },
    actuaciones: { description: 'Actuaciones y trazabilidad administrativa', fields: [id, ref('expediente_id', 'expedientes'), date('fecha', 'Fecha de actuacion'), str('tipo', 'Clase de actuacion', 20), str('descripcion', 'Descripcion de actuacion'), str('responsable', 'Identificador de empleado ficticio', 50)] },
    documentos: { description: 'Metadatos de documentos; no contiene ficheros ni personas reales', fields: [id, ref('expediente_id', 'expedientes'), str('nombre', 'Nombre del archivo simulado'), str('tipo_mime', 'Tipo MIME', 50), date('fecha_registro', 'Fecha de registro'), field('tamano_bytes', 'int', 'Tamano simulado en bytes')] }
  }
};
export const views: Record<DatabaseId, Record<string, string>> = {
  padron: {
    v_poblacion_nucleo: 'SELECT ca.nucleo, COUNT(c.id) AS habitantes FROM ciudadanos c JOIN hogares h ON c.hogar_id=h.id JOIN domicilios d ON h.domicilio_id=d.id JOIN calles ca ON d.calle_id=ca.id GROUP BY ca.nucleo',
    v_hogares: 'SELECT h.id AS hogar_id, d.numero, ca.nombre AS calle, COUNT(c.id) AS habitantes FROM hogares h JOIN domicilios d ON h.domicilio_id=d.id JOIN calles ca ON d.calle_id=ca.id LEFT JOIN ciudadanos c ON c.hogar_id=h.id GROUP BY h.id,d.numero,ca.nombre'
  },
  tributos: {
    v_deuda: 'SELECT l.id AS liquidacion_id, l.referencia, l.importe, COALESCE(SUM(p.importe),0) AS pagado, l.importe-COALESCE(SUM(p.importe),0) AS pendiente FROM liquidaciones l LEFT JOIN pagos p ON p.liquidacion_id=l.id GROUP BY l.id,l.referencia,l.importe',
    v_recaudacion: 'SELECT c.codigo, SUM(p.importe) AS recaudado FROM pagos p JOIN liquidaciones l ON p.liquidacion_id=l.id JOIN objetos_tributarios o ON l.objeto_id=o.id JOIN conceptos c ON o.concepto_id=c.id GROUP BY c.codigo'
  },
  expedientes: { v_expedientes_abiertos: "SELECT e.id, e.codigo, e.ciudadano_id, t.nombre AS procedimiento, e.estado, e.fecha_apertura FROM expedientes e JOIN tipos_expediente t ON e.tipo_id=t.id WHERE e.estado <> 'CERRADO'" }
};