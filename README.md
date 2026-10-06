# Veciana / Laboratorio municipal del dato

Entorno de prueba de gobernanza municipal con PostgreSQL, MySQL, SQL Server y un explorador web. Datos completamente sinteticos: el municipio ficticio no representa al municipio real homonimo ni a sus habitantes.

OpenMetadata no forma parte de este despliegue. El laboratorio ofrece fuentes reales para conectar tu instalacion existente; no sustituye sus ingestas ni muestra resultados obtenidos de OpenMetadata.

## Acceso inmediato

### Desarrollo local y Escoles

Frontend y backend se ejecutan directamente en Windows, con recarga automatica. Las tres bases existentes pueden permanecer en sus contenedores; no es necesario reinicializarlas ni ejecutar `init`.

Con Node.js 22 y las dependencias instaladas (`npm install`), abrir dos terminales en esta carpeta:

```powershell
npm run dev:server
```

```powershell
npm run dev:web
```

El frontend utiliza `WEB_PORT` (8088), el backend `APP_PORT` (8080) y la web Escoles `ESCOLES_PORT` (8090). El modo desarrollo escucha solo en localhost. Si 8088 ya esta ocupado, establecer `$env:WEB_PORT='8089'` en ambas terminales antes de arrancar y en la terminal de pruebas E2E. No sobrescribir el archivo `.env` ni cambiar las credenciales existentes.

Escoles: http://localhost:8090. Una unica tabla HTML, servida sin JavaScript ni API JSON de alumnos, contiene 20 matriculas sinteticas del ano 2026-2027. Una fila por alumno y ano academico; datos del alumno, centro, etapa, curso y matricula en la misma tabla. Las 20 referencias iniciales corresponden a los menores 81-100 del padron; los alumnos nuevos no tienen referencia padronal. Nunca contiene personas reales, documentos ni datos de tutores.

El explorador descarga esa web por HTTP y analiza `#matriculas` con Cheerio. Las columnas y tipos son observados, no un esquema SQL: no declara indices, NOT NULL ni claves fisicas. `ciudadano_id` es una relacion logica declarada. Cada lectura informa selector y fecha de extraccion; los fallos HTTP, cambios de estructura incompatibles y tablas ausentes producen un error, no datos antiguos ni un falso conjunto vacio. Las URLs de extraccion estan controladas por el servidor, no por el usuario.

En **Cambios** se pueden anadir cinco matriculas, modificar una, anadir la columna Beca, renombrar Curso a Nivel y restaurar. El estado y la bitacora se guardan atomicamente en `.local/escoles.json` (ignorado por git); reiniciar conserva cambios. Restaurar conserva la bitacora. Las operaciones usan confirmacion, CSRF e identificadores idempotentes. **Restaurar todo** incluye ahora las cuatro fuentes, con resultados parciales por fuente. La disponibilidad HTML no modifica la comprobacion `/health` de las bases.

Las rutas `/api/sources` y `/api/source/:source/...` ofrecen un contrato de fuentes con tipo y capacidades; las rutas SQL anteriores siguen disponibles. El simulador publica solo la web y recursos visuales; los cambios se controlan desde el backend del laboratorio. Frontend/backend/Escoles no requieren Docker. El despliegue Compose anterior no publica el puerto Escoles y no es el modo de desarrollo de esta ampliacion.

La ingesta de tablas web arbitrarias en OpenMetadata no esta implementada: puede requerir un conector personalizado o extraccion a CSV/SQL, conservando la URL de origen. La calidad mostrada es local, no un resultado de OpenMetadata.

Web: http://localhost:8088

- Acceso directo, sin usuario ni contrasena web.
- La pestaña **Conexiones** muestra puertos, hosts, usuarios y contrasenas de las tres bases, y la URL y selector de la fuente HTML Escoles.

Solo uso local, no productivo. Las credenciales son publicas y exclusivas de este laboratorio; nunca reutilizarlas. El despliegue publica los puertos en `127.0.0.1`, no en toda la red. No usar datos reales, no exponer mediante un proxy ni abrir el firewall hacia la LAN.

## Requisitos

- Docker Desktop con contenedores Linux, WSL2 y arquitectura x86-64. SQL Server Linux no se soporta aqui sobre ARM.
- Recomendado: 6-8 GB disponibles para el laboratorio, ademas de los recursos de OpenMetadata y otros contenedores. SQL Server se configura con limite interno de memoria de 2 GB; no es un limite global del contenedor.
- Puertos `55432`, `53306`, `51433` y `8088` disponibles. Modificables en `.env` antes de arrancar.
- SQL Server 2022 **Developer**: exclusivamente desarrollo y pruebas. Compose establece `ACCEPT_EULA=Y`; revisa los terminos de Microsoft antes de ejecutar el despliegue.
- Node.js 22 solo para ejecutar las pruebas desde Windows; no se requiere para usar el laboratorio en Docker.

## Arranque

Desde PowerShell, en esta carpeta:

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

No sobrescribas un `.env` existente. La copia es necesaria solo en el primer arranque. Los ejemplos de credenciales se pueden personalizar antes de crear los volumenes.

El servicio `init` crea usuarios, tablas, comentarios, indices, vistas y filas; verifica los conteos y termina con codigo 0. Es normal que no aparezca como servicio en ejecucion: `docker compose ps -a` muestra su estado. La web arranca solo despues de una inicializacion correcta.

La inicializacion no repuebla una base marcada como lista: reiniciar conserva cambios. Si un primer arranque se interrumpe antes de completarse, se reconstruye esa base sintetica al reintentar. La aplicacion utiliza un solo contenedor web; no escalar replicas, porque los bloqueos de ejecucion son locales a ese proceso.

```powershell
docker compose stop
docker compose start
docker compose logs --tail 30 init web
```

Para recompilar tras editar codigo: `docker compose up --build -d --wait`. Los servicios existentes de otros proyectos y OpenMetadata no se modifican.

Las contrasenas de los usuarios de bases se establecen cuando se crean. Editar `.env` despues no rota las contrasenas ya persistidas en los motores. Para empezar con credenciales nuevas, exporta cualquier evidencia que quieras conservar y recrea **solo este laboratorio** con los comandos de borrado que se describen abajo.

## Conexiones

| Fuente | Motor fijado | Base | Schema | Windows | Runner en Docker Desktop | Puerto interno |
| --- | --- | --- | --- | --- | --- | --- |
| Padron | PostgreSQL 16.13 | padron | public | localhost:55432 | host.docker.internal:55432 | 5432 |
| Tributos | MySQL 8.4.7 | tributos | tributos | localhost:53306 | host.docker.internal:53306 | 3306 |
| Expedientes | SQL Server 2022 CU22 | expedientes | dbo | localhost:51433 | host.docker.internal:51433 | 1433 |
| Explorador | Node.js 22.22 / React | - | - | localhost:8088 | host.docker.internal:8088 | 8080 |

Dentro de la red Compose se utilizan `padron:5432`, `tributos:3306` y `expedientes:1433`. No utilizar estos nombres desde otra red de Docker sin conectarla expresamente.

**Importante:** el host debe resolver desde el proceso que ejecuta la ingesta, no solo desde el servidor o navegador de OpenMetadata. La ruta `host.docker.internal` se ha comprobado desde un contenedor de este laboratorio en Docker Desktop. Un runner en Linux remoto, Kubernetes o otra maquina necesita otra ruta autorizada; no abrir la exposicion local automaticamente.

| Cuenta | Usuario | Contrasena inicial | Permisos |
| --- | --- | --- | --- |
| OpenMetadata | openmetadata_reader | Veciana_Lectura_2026!Lab | SELECT, metadatos de vistas y estadisticas necesarias; sin DML/DDL |
| Cambios | veciana_lab | Veciana_Cambios_2026!Lab | Escritura y DDL en la base del laboratorio |
| Admin PostgreSQL | postgres | Veciana_PgAdmin_2026!Lab | Arranque y configuracion |
| Admin MySQL | root | Veciana_MyAdmin_2026!Lab | Arranque y configuracion |
| Admin SQL Server | sa | Veciana_SqlAdmin_2026!Lab | Arranque y configuracion |

MySQL utiliza usuarios con host `%` dentro de Docker; la exposicion del host sigue siendo solo local. `veciana_lab` es propietario del esquema/datos del laboratorio; en SQL Server pertenece a `db_owner` de `expedientes`, no a `sysadmin`.

La web y su API de lectura no requieren login. Cualquier persona o proceso con acceso a los puertos locales puede consultar los datos y las credenciales del laboratorio. Las contrasenas de los motores se mantienen para las conexiones de OpenMetadata. Las variables antiguas `WEB_USER` y `WEB_PASSWORD`, si existen en `.env`, ya no se utilizan.

Se crea automaticamente una sesion local sin autenticar, con cookie HttpOnly y SameSite estricto, duracion 8 horas; los POST siguen exigiendo origen de la web y token CSRF. La web renueva esta sesion al ejecutar acciones, tambien tras un reinicio. Las confirmaciones de cambios y restauraciones se mantienen. Esta proteccion evita peticiones de otras paginas, pero no impide acciones de una persona con acceso local. No hay API de SQL libre ni acceso al socket Docker. El navegador no recibe contrasenas en el bundle compilado.

## Conjunto inicial y diccionario

Fecha de referencia reproducible: **2026-10-06**. Datos administrativos en castellano/catalan, importes `DECIMAL(12,2)`, correos `example.invalid`, identificadores no autoincrementales y DNI sinteticos con letra de control calculada excepto errores planificados. No se incluyen adjuntos ni documentos reales. No se simulan NIE en esta primera version.

### Padron: 100 ciudadanos y 206 filas de negocio

| Tabla | Filas | Contenido y relaciones |
| --- | ---: | --- |
| calles | 6 | Via y nucleo ficticio |
| domicilios | 40 | Calle, portal, piso, codigo postal y referencia catastral sintetica; FK a calles |
| hogares | 40 | Unidad de convivencia, fecha de apertura; FK a domicilios |
| ciudadanos | 100 | Identidad, DNI, nacimiento, nacionalidad, hogar, alta, contacto y situacion; FK a hogares |
| movimientos_padron | 20 | Tipo, fecha y motivo del movimiento; FK a ciudadanos |

Vistas `v_hogares` y `v_poblacion_nucleo`. Los 100 ciudadanos son 80 adultos y 20 menores en el conjunto inicial, salvo el nacimiento futuro deliberadamente defectuoso del id 43.

### Tributos: 200 filas totales de negocio

| Tabla | Filas | Contenido y relaciones |
| --- | ---: | --- |
| contribuyentes | 40 | Adultos del Padron, identidad fiscal y contacto; ciudadano_id es relacion logica externa |
| conceptos | 4 | IBI, IVTM, residuos y tasa administrativa |
| objetos_tributarios | 36 | Objeto/bien/servicio; FK a contribuyentes y conceptos |
| liquidaciones | 60 | Ejercicio, referencia, importe neto, fechas y estado; FK a objetos |
| pagos | 45 | Importe, fecha y medio; FK a liquidaciones; pagos completos o parciales conciliados |
| bonificaciones | 15 | Porcentaje, motivo y ejercicio; FK a objetos |

Vistas `v_deuda` y `v_recaudacion`. Importes de liquidaciones ya netos; las bonificaciones no se descuentan de nuevo. Estados coherentes con los pagos. El importe negativo es un defecto intencionado, no un pago o devolucion real.

### Expedientes: 105 filas totales de negocio

| Tabla | Filas | Contenido y relaciones |
| --- | ---: | --- |
| tipos_expediente | 5 | Procedimiento y plazo orientativo |
| expedientes | 30 | Numero, ciudadano, tipo, asunto, estado, fechas, prioridad y unidad; FK a tipos |
| actuaciones | 45 | Trazabilidad, fecha, tipo y responsable ficticio; FK a expedientes |
| documentos | 25 | Nombre, MIME, fecha y tamano; FK a expedientes |

Vista `v_expedientes_abiertos`. `ciudadano_id` corresponde a Padron, sin FK entre motores. El diagrama distingue relaciones fisicas de relaciones logicas; compartir IDs no produce automaticamente linaje entre servicios en OpenMetadata.

Columnas y tablas llevan comentarios introspectables. **Estructura** muestra tipos, nulabilidad, clave primaria, descripcion e indices de la base actual, no un esquema estatico. `_lab_state` y `_lab_operations` son tablas internas excluidas del explorador y de los conteos de negocio. La bitacora persistente vive en `_lab_operations` de cada motor y se conserva al restaurar; no esta dentro de las 200 filas de Tributos. Vistas, estadisticas y logs tampoco cuentan como filas de negocio.

## Anomalias deliberadas

| Fuente / objeto | IDs | Defecto |
| --- | --- | --- |
| Padron ciudadanos.dni | 3, 7, 11 | NULL en adultos |
| Padron ciudadanos.dni | 13, 17 | Cadena vacia |
| Padron ciudadanos.dni | 19, 23 | Formato invalido |
| Padron ciudadanos.dni | 29 | Letra de control incorrecta |
| Padron ciudadanos.dni | 31, 32 | DNI duplicado |
| Padron ciudadanos.email | 37, 41 | Correo malformado |
| Padron ciudadanos.fecha_nacimiento | 43 | Nacimiento futuro |
| Tributos liquidaciones.importe | 4 | Importe negativo |
| Expedientes expedientes.fecha_cierre | 6 | Cierre anterior a apertura |

Los ids 81-100 son menores sin documento: ausencia prevista, no incidente de la regla local de documento obligatorio en adultos. Los contribuyentes 1-40 replican DNI y contacto del Padron: sus NIF heredan NULL en 3,7,11; vacios en 13,17; formatos/letra invalidos en 19,23,29; duplicado en 31,32; correo invalido en 37. Esto permite estudiar propagacion de calidad entre sistemas. No se sincronizan automaticamente tras cambios posteriores.

La pestaña **Calidad** evalua reglas locales y compara los IDs afectados con los esperados. No representa la ejecucion de tests ni alertas de OpenMetadata. Las incidencias se suman por regla y pueden afectar al mismo ciudadano.

## Escenarios y restauracion

**Cambios** permite preparar, revisar y confirmar una accion por base:

| Accion | Resultado |
| --- | --- |
| Anadir 5 registros | 5 ciudadanos, 5 liquidaciones o 5 expedientes, segun fuente; hasta 10 lotes por restauracion |
| Actualizar un registro | Cambia email del ciudadano 1, email_notificacion del contribuyente 1 o unidad del expediente 1 |
| Anadir columna | canal_origen VARCHAR(30) NULL en ciudadanos, liquidaciones o expedientes |
| Cambiar tipo | telefono VARCHAR a TEXT en Padron; email_notificacion VARCHAR a TEXT en Tributos; prioridad INT a BIGINT en Expedientes |
| Generar actividad SQL | Lectura de vistas y uniones para estadisticas de uso |
| Restaurar base | Reconstruye tablas, vistas, indices, comentarios y filas iniciales de esa fuente |
| Restaurar todo | Reconstruccion secuencial de las tres fuentes; requiere escribir RESTAURAR TODO |

La vista previa de insercion representa un lote parametrizado generado por el servidor; no es SQL para copiar y ejecutar. No se permite introducir scripts arbitrarios. Nuevos ciudadanos no se replican automaticamente en las otras fuentes.

Un identificador de peticion evita aplicar dos veces una peticion completada, tambien tras reiniciar. Los cambios estructurales se detectan como ya aplicados si se repiten hasta restaurar. Cada base bloquea acciones simultaneas, y la restauracion global bloquea acciones en todas las fuentes. Los escenarios de DML son transaccionales. MySQL DDL aplica **autocommit**: un fallo puede dejar cambios parciales; se registra el fallo y se requiere restaurar antes de nuevas acciones. No existe transaccion distribuida ni rollback global entre motores.

La bitacora recoge peticion, accion, fecha, estado, SQL predefinido y conteos/esquema antes y despues; no guarda contrasenas. Si se interrumpe una accion y queda `pending`, la siguiente accion de escritura se rechaza hasta restaurar. Un fallo tambien requiere restauracion, incluido alcanzar el limite de lotes. La restauracion global devuelve el resultado de cada base y puede fallar parcialmente; reintentar con una nueva confirmacion si ocurre.

Restaurar desde la web elimina los cambios de prueba y conserva historial. Para un borrado integral e irreversible de **los datos y la bitacora de este laboratorio**:

```powershell
docker compose down -v
docker compose up --build -d --wait
```

Estos comandos no deben ejecutarse desde otra carpeta ni contra otro proyecto Compose. No afectan a OpenMetadata.

## Pruebas con OpenMetadata

Consulta primero tu version instalada: los nombres de pantallas, opciones y soporte avanzado cambian entre versiones. No se entrega YAML de ingesta ligado a una version desconocida. Referencias oficiales:

- https://docs.open-metadata.org/latest/connectors/database/postgres
- https://docs.open-metadata.org/latest/connectors/database/mysql
- https://docs.open-metadata.org/latest/connectors/database/mssql

### Configurar servicios

1. En Database Services crea `veciana_padron`, `veciana_tributos` y `veciana_expedientes` con los conectores PostgreSQL, MySQL y MSSQL.
2. Usa `openmetadata_reader`, su contrasena y el host/puerto correspondiente de la tabla de conexiones. Usa la ruta accesible desde el **runner de ingesta**.
3. Restringe a las bases/schemas municipales. Excluye tablas `^_lab_.*` y en PostgreSQL las vistas `^pg_stat_statements.*` de la ingesta de objetos de negocio. Conserva el acceso a estadisticas para uso/linaje.
4. PostgreSQL local no configura TLS: ajustar `sslmode=disable` o `prefer` segun driver. MySQL tiene TLS autogenerado: usar los valores adecuados para tu driver y evitar exigir un CA de produccion inexistente. No cambiar autenticacion a mecanismos obsoletos.
5. Para MSSQL se recomienda `mssql+pyodbc` con ODBC Driver 18, cifrado activado y `TrustServerCertificate=yes` **solo en este laboratorio con certificado local**. El runner necesita ese driver. Si tu version no lo incluye, utiliza un esquema soportado por tu version y consulta su configuracion TLS; los ajustes de pyodbc no se trasladan automaticamente a pytds/pymssql.
6. Ejecuta **Test Connection** y guarda las evidencias. Activa tablas, vistas, comentarios/DDL y exclusiones segun las opciones disponibles en tu version. Ejecuta la primera ingesta de metadatos.

### Matriz de comprobacion

| Prueba | Accion en el laboratorio | Ejecutar en OpenMetadata | Evidencia esperada |
| --- | --- | --- | --- |
| Descubrimiento | Estado inicial | Metadatos | Tablas, vistas, columnas, PK/FK, descripciones y tipos iniciales |
| Perfilado | Estado inicial | Profiler con muestra 100% | ciudadanos=100; liquidaciones=60; expedientes=30 |
| Calidad | Estado inicial | Tests de calidad | Nulos, vacios, duplicados, formatos, negativo y fechas detectados con reglas apropiadas |
| Crecimiento | Anadir 5 registros | Profiler y tests | Conteo 105 / 65 / 35 de la tabla principal segun fuente |
| Actualizacion | Actualizar un registro | Muestreo/perfilado/tests | Nuevo contacto o unidad; conteo sin cambio |
| Nueva columna | Anadir columna | Metadatos | canal_origen nueva, nullable y VARCHAR(30) |
| Tipo de dato | Cambiar tipo | Metadatos | VARCHAR a TEXT o INT a BIGINT; historial/version de entidad segun soporte |
| Uso/linaje | Generar actividad SQL | Workflows Usage/Lineage compatibles | Consultas registradas, uso y linaje de vistas/uniones segun conector/version |
| Restauracion | Restaurar base | Metadatos, Profiler y tests | Columna eliminada, tipo original y conteos iniciales; historial segun soporte |

Los botones **no llaman a OpenMetadata**. Cambiar filas no actualiza por si solo un catalogo de metadatos; para contar filas hay que volver a ejecutar el perfilado. Cambiar columnas requiere una nueva ingesta de metadatos. No es CDC ni deteccion instantanea. Las muestras no garantizan incluir un valor concreto; para este conjunto pequeno usar perfilado completo y comprobar valores en la fuente.

### Calidad, clasificacion y gobernanza

- DNI: separar `NULL` y vacio; evaluar obligatoriedad **solo en adultos**. Formato numerico con letra no comprueba la letra de control: usar regla SQL personalizada compatible con tu version para validar el modulo 23. Unicidad debe ignorar NULL/vacios segun la politica definida.
- Email: regla de formato; fecha_nacimiento <= `2026-10-06`; liquidaciones.importe >= 0; fecha_cierre nula o posterior/igual a fecha_apertura.
- Configurar tests en los objetos replicados de Tributos para comparar propagacion de defectos. El dashboard local evalua solo las reglas de su catalogo, no una bateria universal.
- Probar Sample Data, clasificacion automatica y etiquetado manual de DNI/contacto como datos personales sinteticos. No subir informacion real para probar PII.
- Crear glosario (Ciudadano, Hogar, Contribuyente, Liquidacion, Expediente), dominios, owners y politicas en OpenMetadata. Asociar conceptos a tablas/columnas y comprobar revision de descripciones.
- El soporte de owners/tags del motor no es uniforme; no confundir permisos del motor con ownership de gobernanza en OpenMetadata.

### Uso y linaje: lo preparado y sus limites

- PostgreSQL: `pg_stat_statements` precargado, captura de consultas internas `track=all` y lector con `pg_read_all_stats`. Es estadistica agregada normalizada, no log completo con marcas temporales; puede perder entradas por eviction o reset. Vistas ayudan a probar linaje sin depender del historial.
- MySQL: `general_log=ON`, `log_output=TABLE` y SELECT especifico a `mysql.general_log`. El log **crece mientras el motor esta encendido** y no cuenta en las 200 filas de negocio. No dejarlo semanas sin mantenimiento. Para vaciarlo, despues de ingerir uso/linaje, usa `docker compose exec tributos mysql -u root -p` e introduce la contrasena directamente en el terminal; ejecuta `SET GLOBAL general_log='OFF'; TRUNCATE TABLE mysql.general_log; SET GLOBAL general_log='ON';`. No hay rotacion automatica en este laboratorio. Puede desactivarse permanentemente si no pruebas uso/linaje.
- SQL Server: Query Store con captura ALL, retencion 7 dias y limite 64 MB. Lector con VIEW DEFINITION, VIEW DATABASE PERFORMANCE STATE y VIEW SERVER PERFORMANCE STATE. Compatibilidad de lectura de Query Store/DMVs depende de la version del conector.
- Usuarios lectores no pueden ejecutar procedimientos municipales; no se incluyen procedimientos, dbt, SSIS, autenticacion IAM ni TLS de produccion. Son ampliaciones posibles, no capacidades ya probadas.
- El linaje entre motores no se genera por compartir ciudadano_id. Para probarlo se necesita una transformacion registrada o declarar el linaje explicitamente en OpenMetadata.

La integracion con tu OpenMetadata y su runner queda pendiente de **Test Connection**, ingesta y evidencias en esa instalacion. No se ha desplegado ni actualizado OpenMetadata, ni se afirma que haya detectado cambios en estas pruebas locales.

## Verificacion automatizada

```powershell
npm ci
npm run typecheck
npm test
npm run test:integration
npx tsx tests/integration.ts --persistence
npm run test:e2e
```

`test:integration` accede a los motores publicados, modifica datos y estructuras y **restaura las tres bases**, dejando entradas en la bitacora. No ejecutarlo mientras quieras conservar un escenario personalizado. Comprueba conteos, comentarios, PK/FK, filtros seguros, anomalías, permisos, estadisticas, DML/DDL, duplicacion de peticiones, concurrencia, limites y recuperacion de operaciones interrumpidas.

La opcion `--persistence` tambien reinicia el contenedor web y ejecuta de nuevo el servicio init, comprobando que mantiene las filas anadidas y las peticiones completadas antes de restaurar.

`test:e2e` requiere la web levantada y Microsoft Edge instalado. Usa el canal **msedge**, no Chromium descargado; prueba escritorio 1440x960 y movil 390x844, navegacion, filtros, grafo no vacio, cambios/restauracion y seguridad de API. Capturas y trazas en `test-results/`; las capturas de Conexiones no se generan para evitar guardar contrasenas.

El primer arranque, la compilacion Docker, los tres motores, sus puertos publicados desde Windows y la ruta Docker Desktop han sido comprobados. No se han simulado todos los fallos de infraestructura ni realizado una auditoria de seguridad productiva.

`npm audit` no presenta avisos altos ni criticos en la revision inicial. Mantiene tres avisos moderados de la misma cadena `mssql -> tedious -> sprintf-js`; el registro no publica una correccion compatible de sprintf-js y la sugerencia automatica degrada mssql a una version antigua. No se ha aplicado ese downgrade. El formato de errores se sanea y no se ofrece SQL arbitrario; aun asi, este aviso sigue pendiente, por lo que el entorno debe mantenerse local y no productivo.

## Codigo y mantenimiento

- `server/fixtures.ts`: datos deterministas, totales y manifest de defectos.
- `server/model.ts`: modelo y vistas; el inicializador genera DDL por dialecto a partir de este contrato.
- `server/seed.ts`: usuarios, permisos, DDL, comentarios, seed y restauracion. No hay scripts SQL duplicados.
- `server/databases.ts`: drivers, parametros, roles y transacciones.
- `server/explorer.ts`: catálogos reales, exploracion y reglas locales.
- `server/scenarios.ts`: escenarios permitidos, comparacion e historial persistente.
- `server/index.ts`: sesion local automatica, rutas, CSRF y servicio de la web sin login.
- `web/src/App.tsx` y `web/src/styles.css`: explorador responsive con React Flow, lucide y tipografia local IBM Plex.

El Dockerfile compila frontend/backend y los sirve en un contenedor Node sin privilegios root. Las bases persisten en volumenes nombrados de este proyecto; no hay montajes de datos de otros proyectos ni Docker socket. El volumen auxiliar `historial` esta reservado para futuros exports; la bitacora activa esta en las tablas internas de cada motor.