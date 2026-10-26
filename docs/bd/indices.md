# T-007 · Validadores e índices de MongoDB

Fecha de revisión del código: 23 de octubre de 2026.

## 1. Objetivo y estado

T-007 prepara la configuración de validadores e índices de UTM Desk para que el
DBA autorizado pueda aplicarla posteriormente en MongoDB Atlas M0. La fuente de
verdad es `backend/scripts/init_db.py`.

La revisión confirmó que el código ya contenía correctamente los tres índices
obligatorios. No fue necesario modificar `init_db.py`; se añadieron pruebas
unitarias para congelar la configuración y este procedimiento de diagnóstico,
respaldo, aplicación y comprobación.

**Estado operacional:** preparado en el repositorio, pero no aplicado ni
verificado en Atlas. Codex no se conectó a Atlas, no leyó credenciales y no
ejecutó migraciones, respaldos ni operaciones destructivas.

## 2. Colecciones y validadores

`main()` llama a `asegurar_coleccion()` para estas cuatro colecciones:

| Colección | Definición |
|---|---|
| `incidencias_campus` | `esquema_incidencias()` |
| `usuarios` | `esquema_usuarios()` |
| `roles` | `esquema_roles()` |
| `categorias` | `esquema_categorias()` |

Si la colección no existe, `asegurar_coleccion()` la crea con el validador. Si
ya existe, aplica `collMod` sin recrearla. En ambos casos configura:

```text
validationLevel: "strict"
validationAction: "error"
```

El esquema de incidencias exige tipos BSON, fechas `date`, referencias
`ObjectId`, `schema_version`, los campos universales y una rama de
`detalle_especifico` según la categoría. Un `$expr` obliga a que la categoría de
la raíz coincida con `detalle_especifico.categoria`. `fecha_resolucion` es una
fecha BSON opcional: no debe existir antes de resolver la incidencia.

Los validadores de `usuarios`, `roles` y `categorias` proceden de T-008 y no se
relajaron ni sustituyeron.

## 3. Índices definidos actualmente

Los nombres sin nombre explícito son los que MongoDB genera normalmente a partir
de las claves. El DBA debe comparar por claves y opciones, no solo por nombre.

| Colección | Índice | Campos | Opciones | Función |
|---|---|---|---|---|
| `incidencias_campus` | Compuesto T-007 | `{categoria: 1, estado: 1, "ubicacion.edificio": 1}` | — | Filtros combinados de tablero |
| `incidencias_campus` | TTL T-007 | `{fecha_resolucion: 1}` | `expireAfterSeconds: 5184000` | Depuración 60 días después de la resolución |
| `incidencias_campus` | `texto_titulo_descripcion` | `{titulo: "text", descripcion: "text"}` | pesos 10/5, idioma `spanish` | Búsqueda por relevancia |
| `incidencias_campus` | Código | `{codigo: 1}` | `unique: true` | Folios sin duplicados |
| `incidencias_campus` | Mis reportes | `{"reportante.usuario_id": 1, fecha_creacion: -1}` | — | Alcance propio y orden reciente |
| `incidencias_campus` | Bandeja técnica | `{"tecnico_asignado.usuario_id": 1, estado: 1}` | — | Incidencias asignadas |
| `incidencias_campus` | Analítica por edificio | `{estado: 1, "ubicacion.edificio": 1}` | — | Pipeline de edificios |
| `incidencias_campus` | Recientes | `{fecha_creacion: -1}` | — | Listados recientes |
| `usuarios` | Correo | `{correo: 1}` | `unique: true` | Unicidad de cuentas |
| `roles` | Clave | `{clave: 1}` | `unique: true` | Unicidad de roles |
| `categorias` | Clave | `{clave: 1}` | `unique: true` | Unicidad de categorías |

MongoDB crea además `_id_` en cada colección. `crear_indices()` no elimina ni
recrea índices. `create_index()` es idempotente cuando claves y opciones
coinciden; si existe la misma clave con opciones incompatibles, la ejecución debe
detenerse para que el DBA revise el conflicto. No se debe ocultar el error ni usar
`dropIndex()` como corrección automática.

## 4. Índice compuesto

La secuencia exacta es categoría, estado y edificio, todos ascendentes. Puede
beneficiar consultas frecuentes que proporcionen el prefijo del índice, por
ejemplo:

```javascript
db.incidencias_campus.find({
  categoria: "infraestructura",
  estado: "abierta",
  "ubicacion.edificio": "A"
}).explain("executionStats")
```

El DBA debe revisar `queryPlanner.winningPlan`, `nReturned`,
`totalKeysExamined` y `totalDocsExamined`. Este documento no afirma que MongoDB
elegirá el índice: la elección depende de la forma de la consulta, selectividad,
estadísticas y datos reales. Los filtros por alcance siguen siendo obligatorios
en la API.

## 5. Índice TTL y riesgo de eliminación

El índice TTL es de un solo campo y utiliza:

```text
fecha_resolucion: 1
expireAfterSeconds: 5184000
```

MongoDB elimina el documento completo aproximadamente 60 días después de la
fecha almacenada; el monitor TTL no garantiza el segundo exacto. En el flujo
actual, la transición a `resuelta` agrega `fecha_resolucion`, `cerrada` la
conserva y la reapertura a `en_proceso` la elimina con `$unset`.

Existe riesgo si documentos históricos o modificados fuera de la API conservan
`fecha_resolucion` estando en un estado no terminal. El TTL considera la fecha,
no el estado, y podría eliminarlos. Antes de activarlo, el DBA debe ejecutar
consultas de solo lectura como estas:

```javascript
const segundosRetencion = 5184000
const corte = new Date(Date.now() - segundosRetencion * 1000)

db.incidencias_campus.countDocuments({
  fecha_resolucion: { $type: "date", $lte: corte }
})

db.incidencias_campus.find(
  {
    fecha_resolucion: { $type: "date" },
    estado: { $nin: ["resuelta", "cerrada"] }
  },
  { _id: 1, codigo: 1, estado: 1, fecha_resolucion: 1 }
).limit(100)
```

Debe registrarse cuántos documentos expirarían inmediatamente y el efecto sobre
los indicadores analíticos. El TTL no elimina automáticamente objetos de
Backblaze B2, por lo que también debe evaluarse la generación de evidencias
huérfanas. No debe declararse seguro para producción hasta completar esta revisión.

## 6. Índice de texto

La colección solo puede tener un índice de texto convencional. La definición
vigente pondera el título con 10 y la descripción con 5, usa español y tiene el
nombre `texto_titulo_descripcion`.

Consulta y comprobación manual:

```javascript
db.incidencias_campus.find(
  { $text: { $search: "falla red" } },
  { codigo: 1, titulo: 1, score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } }).explain("executionStats")
```

El DBA debe guardar el plan real saneado y comprobar que corresponde al índice
de texto. No se inventan aquí etapas ni cifras de rendimiento.

## 7. Diagnóstico previo de solo lectura

Estas instrucciones son para ejecución manual por el DBA autorizado. Antes de
cualquier cambio debe seleccionar explícitamente la base correcta y no compartir
la URI, credenciales ni salidas con información personal.

### Colecciones y validadores

```javascript
db.getCollectionInfos()

for (const nombre of ["incidencias_campus", "usuarios", "roles", "categorias"]) {
  const info = db.getCollectionInfos({ name: nombre })[0]
  printjson({
    name: nombre,
    validationLevel: info?.options?.validationLevel,
    validationAction: info?.options?.validationAction,
    validator: info?.options?.validator
  })
}
```

El resultado esperado después de aplicar es `strict` y `error` en las cuatro.
Antes de aplicar, cualquier ausencia o diferencia se registra como hallazgo, no
se corrige directamente desde Atlas.

### Índices y conflictos

```javascript
db.incidencias_campus.getIndexes()
db.usuarios.getIndexes()
db.roles.getIndexes()
db.categorias.getIndexes()
```

Revisar:

- mismas claves y orden del compuesto;
- TTL de un solo campo y exactamente 5184000 segundos;
- como máximo un índice de texto, con pesos, idioma y nombre esperados;
- ausencia de la misma clave con opciones distintas;
- conservación de índices únicos y operacionales de la tabla anterior.

Si aparece un TTL con otra duración, un índice de texto diferente o cualquier
conflicto de opciones, se detiene la aplicación. El equipo debe aprobar un cambio
explícito en `init_db.py` o un script idempotente de migración de índices que use
el mecanismo compatible con la versión de MongoDB. No se elimina ni recrea el
índice automáticamente.

### Compatibilidad histórica mínima

Las siguientes consultas muestran conteos y campos técnicos, sin datos personales:

```javascript
db.incidencias_campus.countDocuments({ schema_version: { $ne: 1 } })
db.usuarios.countDocuments({ schema_version: { $ne: 1 } })
db.incidencias_campus.countDocuments({ fecha_creacion: { $not: { $type: "date" } } })
db.incidencias_campus.countDocuments({ fecha_actualizacion: { $not: { $type: "date" } } })
db.incidencias_campus.countDocuments({ "detalle_especifico.categoria": { $exists: false } })
```

Si hay resultados distintos de cero, se diagnostican en una restauración
separada. Una migración debe ser específica, idempotente y de simulación por
defecto; no se relaja el validador para hacerla pasar.

## 8. Respaldo previo a cambios de esquema

Atlas M0 no aporta el respaldo operativo requerido por esta tarea. Antes de
aplicar `collMod` o índices, el DBA debe crear un `mongodump` con una cuenta de
respaldo de privilegios mínimos: rol de respaldo adecuado o acceso de lectura a
la base y metadatos necesarios, sin reutilizar la cuenta de la API.

La URI se carga en una variable de entorno del equipo del DBA desde su gestor de
secretos; no se escribe en el comando, el repositorio, capturas ni logs. Ejemplo
en PowerShell, suponiendo que `MONGODB_BACKUP_URI` ya está definida:

```powershell
$carpetaRespaldo = 'D:\respaldos-utm-desk'
$archivoRespaldo = Join-Path $carpetaRespaldo 'utm_desk_pre_t007.archive.gz'
mongodump --uri="$env:MONGODB_BACKUP_URI" --db='utm_desk' --archive="$archivoRespaldo" --gzip
Get-Item -LiteralPath $archivoRespaldo
Get-FileHash -Algorithm SHA256 -LiteralPath $archivoRespaldo
```

La carpeta debe estar fuera del repositorio, con acceso restringido y cifrado si
corresponde. No se añade el archivo a Git. El DBA verifica el código de salida,
que el archivo tenga tamaño mayor que cero y conserva su SHA-256.

La restaurabilidad se comprueba en una base local o aislada y vacía, nunca sobre
producción:

```powershell
mongorestore --uri='mongodb://localhost:27017' --archive="$archivoRespaldo" --gzip `
  --nsFrom='utm_desk.*' --nsTo='utm_desk_restore_t007.*'
```

Después se comparan conteos por colección e índices esperados. Se registra fecha,
responsable, ubicación protegida, hash y resultado de restauración. Este respaldo
puntual no implementa la automatización periódica de T-010.

## 9. Aplicación manual autorizada en Atlas

### Fase A · Revisión

1. Acordar ventana de mantenimiento y DBA responsable.
2. Confirmar que la cuenta de aplicación no se usará para cambios de esquema.
3. Ejecutar el diagnóstico de solo lectura anterior.
4. Revisar documentos incompatibles y candidatos a expiración inmediata.
5. Confirmar que no hay conflictos de índices.

### Fase B · Respaldo

1. Ejecutar `mongodump` fuera del repositorio.
2. Verificar tamaño, hash y código de salida.
3. Restaurar en una base separada y comparar conteos.
4. Registrar fecha y responsable.

### Fase C · Autorización

Obtener confirmación explícita del equipo después de revisar diagnóstico,
retención TTL y respaldo. La asignación del issue no equivale a autorización de
producción.

### Fase D · Aplicación

El DBA configura en su propia terminal `MONGODB_ADMIN_URI` y `MONGODB_DB`, revisa
que apunten al destino aprobado y, desde `backend/`, ejecuta:

```powershell
python scripts/init_db.py
```

El script elige `MONGODB_ADMIN_URI` cuando está definida; si no, cae en
`MONGODB_URI`. El DBA debe comprobar este punto antes de ejecutarlo. Sin banderas,
el script crea o actualiza las cuatro colecciones y validadores, crea los índices
idempotentes y ejecuta semillas con `$setOnInsert`. Puede crear el administrador
si no existe. No se deben utilizar `--seed-demo` ni `--reset-demo` en producción.

### Fase E · Comprobaciones

1. Confirmar `strict/error` mediante `getCollectionInfos()`.
2. Confirmar claves y opciones reales mediante `getIndexes()`.
3. Verificar que los índices anteriores continúan presentes.
4. En una base de prueba autorizada, comprobar que un documento inválido produce
   `Document failed validation` y que la API responde 400 a un detalle inválido.
5. Ejecutar ambos `explain("executionStats")` y conservar los planes reales.
6. Vigilar conteos y analítica durante la ventana acordada.

### Fase F · Evidencias

Registrar únicamente salidas saneadas:

| Evidencia | Estado | Fecha | Responsable | Referencia |
|---|---|---|---|---|
| Respaldo creado y restaurado | Pendiente del DBA | — | — | — |
| `getCollectionInfos()` con `strict/error` | Pendiente del DBA | — | — | — |
| Salida real de `getIndexes()` | Pendiente del DBA | — | — | — |
| Rechazo de documento inválido en prueba | Pendiente del DBA | — | — | — |
| `explain()` compuesto y de texto | Pendiente del DBA | — | — | — |
| Captura de Atlas sin secretos | Pendiente del DBA | — | — | — |

No debe sustituirse esta tabla por resultados fabricados. La salida real de
`db.incidencias_campus.getIndexes()` y las capturas se incorporarán solamente
después de que el DBA ejecute y verifique el procedimiento.

## 10. Verificación local de código

Las pruebas unitarias de `backend/tests/test_indices_mongodb.py` verifican sin
MongoDB que:

- existen los cuatro validadores y se conserva la coherencia de categoría;
- `asegurar_coleccion()` usa `strict/error` al crear y con `collMod`;
- los tres índices T-007 tienen claves, orden y opciones exactas;
- se conservan los otros índices;
- una segunda llamada repite las mismas definiciones sin introducir variantes
  incompatibles.

Las comprobaciones reales de Atlas, los E2E locales destructivos y Postman quedan
reservados para el DBA y la etapa integral de pruebas indicada en el issue.

