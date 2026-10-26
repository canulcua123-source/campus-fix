# T-013 · Script maestro y exportación JSON

T-013 contiene tres entregables obligatorios:

- `backend/scripts/exportar_entrega.py`: generador y exportador seguro.
- `entrega/script_maestro.js`: artefacto generado para `mongosh`.
- `entrega/incidencias_campus.json`: arreglo MongoDB Extended JSON con 24 incidencias sintéticas.

El JavaScript no es una segunda fuente de verdad. El exportador carga los cuatro validadores, los índices, los cinco roles, las tres categorías y el generador de T-009 directamente desde `backend/scripts/init_db.py`. Esa carga se realiza sin importar la configuración de la aplicación y sin leer `.env`. Los índices se capturan ejecutando `crear_indices()` contra objetos en memoria; no se abre una conexión a MongoDB.

## Generación sin conexión

Desde PowerShell, en `backend/`:

```powershell
.\.venv\Scripts\python.exe scripts\exportar_entrega.py
```

El modo predeterminado usa como referencia las 12:00 UTC del día actual. Así las resoluciones siguen dentro de los 60 días del índice TTL. Para repetir exactamente una generación, indique la misma fecha ISO 8601 con zona horaria:

```powershell
.\.venv\Scripts\python.exe scripts\exportar_entrega.py `
  --fecha-referencia "2026-10-24T12:00:00+00:00"
```

Con los mismos parámetros y fecha, ambos archivos son equivalentes byte por byte. Este modo crea `incidencias_campus.json` en memoria; no debe describirse como una ejecución de `mongoexport`.

El JSON es un arreglo UTF-8 en Extended JSON canónico. Contiene exclusivamente incidencias `demo: true`, con `_id`, referencias `ObjectId` y fechas BSON reconstruibles. No incluye usuarios, roles, categorías, contraseñas, hashes, tokens, correos ni URI. La identidad referenciada usa el ObjectId fijo `64f000000000000000000013` y el nombre reconocible `Usuario Sintético T-013`.

## Ejecución manual posterior en MongoDB local

Esta etapa requiere que la persona responsable tenga instalados `mongosh` y MongoDB Database Tools. No se instalan automáticamente. Debe usarse una instancia local autorizada y una base nueva, vacía y aislada llamada `utm_desk_entrega`.

Primero genere los artefactos. Después, desde `backend/`, ejecute una sola vez:

```powershell
mongosh "mongodb://127.0.0.1:27017/utm_desk_entrega" "..\entrega\script_maestro.js"
```

El propio script verifica antes de escribir que:

- la conexión sea `localhost`, `127.0.0.1` o `::1`;
- la base se llame exactamente `utm_desk_entrega`;
- la base no contenga ninguna colección.

Si una condición falla, el script se detiene. No intenta vaciar la base, borrar colecciones ni eliminar documentos. No debe ejecutarse contra Atlas, producción, `utm_desk`, `utm_desk_test` ni una base reutilizada.

El script crea `incidencias_campus`, `usuarios`, `roles` y `categorias` con `validationLevel: "strict"` y `validationAction: "error"`; instala únicamente los índices vigentes; inserta catálogos, un usuario fixture inactivo y las 24 incidencias. El campo `password_hash` exigido por el validador del usuario contiene el marcador literal `FIXTURE_NO_UTILIZABLE_T013`: no es un hash válido ni permite iniciar sesión.

## Demostraciones incluidas

Las cinco actualizaciones actúan mediante `updateOne()` sobre una incidencia abierta identificada por `_id`, código, `demo: true` y estado:

| Operador | Demostración | Conservación del dataset |
|---|---|---|
| `$set` | Cambia temporalmente la prioridad | Restaura la prioridad original |
| `$inc` | Suma 0.25 a `horas_invertidas` | Resta 0.25 inmediatamente |
| `$push` | Agrega una etiqueta con `$slice: -15` | La etiqueta se retira al final |
| `$addToSet` | Agrega otra etiqueta sin duplicarla | La etiqueta se retira al final |
| `$pull` | Retira solo las dos etiquetas temporales | Conserva las etiquetas originales |

Después se comprueban la prioridad, las horas, las etiquetas y el total de 24 incidencias. También se ejecutan:

- una consulta `$text` sobre título y descripción, con proyección y orden `textScore`, limitada a cinco resultados;
- Pipeline 1 de `GET /analitica/edificios`, con `$match`, `$project`, `$group`, `$sum`, `$avg`, `$sort` y `$project`;
- Pipeline 2 de `GET /analitica/tags`, con `$match`, `$unwind`, `$group`, desempate por etiqueta, `$limit: 10` y `$project`.

Los `$match` del entregable se limitan a `demo: true`. Son una adaptación para la base académica aislada y no sustituyen los controles de alcance y permisos de la API.

## Exportación real desde la base local

Use exactamente la misma fecha con la que se generó y ejecutó el script maestro:

```powershell
.\.venv\Scripts\python.exe scripts\exportar_entrega.py `
  --modo exportacion-local `
  --fecha-referencia "2026-10-24T12:00:00+00:00" `
  --uri-local "mongodb://127.0.0.1:27017/utm_desk_entrega"
```

Este modo valida la URI antes de iniciar el proceso, rechaza `mongodb+srv`, hosts externos, otras bases y credenciales embebidas. Ejecuta `mongoexport` con argumentos separados, `--query '{"demo":true}'`, `--jsonArray` y `--jsonFormat=canonical`. Luego reconstruye los tipos BSON, aplica los 17 criterios de T-009 y exige que la exportación coincida con el generador y la fecha indicados antes de publicar el archivo.

El comando equivalente, útil para inspección manual en PowerShell, es:

```powershell
mongoexport `
  --uri "mongodb://127.0.0.1:27017/utm_desk_entrega" `
  --db "utm_desk_entrega" `
  --collection "incidencias_campus" `
  --query '{"demo":true}' `
  --jsonArray `
  --jsonFormat=canonical `
  --out "..\entrega\incidencias_campus.json"
```

El exportador automatizado es preferible porque agrega las comprobaciones de seguridad, privacidad y coherencia. `mongoexport` solo lee la colección y no modifica la base.

## Verificación

Las pruebas sin servicios externos se ejecutan desde `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_exportar_entrega.py -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m compileall -q scripts
```

Después de cargar el script en MongoDB local, el verificador existente de T-009 se ejecuta así:

```powershell
$env:MONGODB_DEMO_URI = "mongodb://127.0.0.1:27017"
$env:MONGODB_DEMO_DB = "utm_desk_entrega"
.\.venv\Scripts\python.exe scripts\verificar_demo.py
Remove-Item Env:MONGODB_DEMO_URI
Remove-Item Env:MONGODB_DEMO_DB
```

La ejecución real de `mongosh`, `mongoexport` y `verificar_demo.py` queda para la prueba manual posterior con MongoDB local. No se ha usado ni debe usarse Atlas para validar T-013.
