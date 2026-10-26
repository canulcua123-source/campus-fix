# Respaldo y restauración de MongoDB (T-010)

## 1. Objetivo

MongoDB Atlas M0 no incluye respaldos automáticos. Este procedimiento permite al
DBA autorizado crear una copia comprimida de `utm_desk`, conservarla fuera del
repositorio en almacenamiento cifrado y probarla periódicamente en una base
local aislada. Cumple RNF-22 y la regla BD-24.

El script prepara el respaldo; no sustituye la prueba de restauración. Un
archivo solo se considera recuperable después de restaurarlo y verificarlo.

## 2. Herramientas necesarias

- Bash (Linux, WSL o Git Bash en Windows).
- MongoDB Database Tools **100.3.0 o posterior**. Esa versión introdujo
  `mongodump --config`, utilizado para que la URI no aparezca en los argumentos
  del proceso.
- `gzip`, `sha256sum`, `realpath` y utilidades POSIX incluidas en Git Bash/WSL.
- Una cuenta MongoDB de respaldo con privilegios mínimos de lectura sobre
  `utm_desk` y los metadatos que `mongodump` necesite. No reutilizar la cuenta de
  escritura de la API ni una cuenta administradora del clúster.
- Un volumen o directorio externo cifrado, con acceso exclusivo para el DBA.
- MongoDB local para probar la restauración.

Comprobar las herramientas sin conectarse a MongoDB:

```bash
mongodump --version
mongodump --help | grep -- --config
mongorestore --version
```

En Windows se debe ejecutar el script desde Git Bash o WSL. Una ruta como
`D:\respaldos-utm-desk` se expresa como `/d/respaldos-utm-desk` en Git Bash o
`/mnt/d/respaldos-utm-desk` en WSL. No se instala ninguna herramienta de forma
automática.

## 3. Preparación del entorno

1. El DBA confirma la ventana de respaldo y que su IP autorizada ya cumple la
   política de Atlas. Nunca se habilita `0.0.0.0/0`.
2. Prepara un destino dedicado fuera del clon, protegido con BitLocker, LUKS,
   FileVault u otro mecanismo aprobado por el equipo.
3. Restringe el acceso del directorio al usuario responsable. El script aplica
   `umask 077`, `0700` al directorio y `0600` a los archivos; en Windows también
   deben revisarse las ACL de NTFS porque `chmod` de Git Bash no sustituye ese
   control.
4. Obtiene la URI desde el gestor de secretos en la sesión autorizada. No la
   escribe en archivos persistentes, historial, capturas ni comandos visibles.

## 4. Variables de configuración

| Variable | Obligatoria | Uso |
|---|---|---|
| `MONGODB_URI_RESPALDO` | Sí | URI entregada por el gestor de secretos. El script la copia a un YAML temporal `0600`, la elimina del entorno hijo y limpia el archivo al salir. |
| `RESPALDOS_DIR` | Sí | Ruta absoluta de un directorio dedicado, externo al repositorio. |
| `RESPALDOS_DESTINO_CIFRADO` | Sí | Debe valer `confirmado`; registra que el DBA verificó el cifrado del destino. El script no puede auditar por sí mismo BitLocker/LUKS/FileVault. |

T-010 estandariza `MONGODB_URI_RESPALDO`, conforme a BD-24. El ejemplo histórico
de [índices](indices.md#8-respaldo-previo-a-cambios-de-esquema) usa
`MONGODB_BACKUP_URI`; al seguir este procedimiento el gestor de secretos debe
entregar el valor con el nombre nuevo, sin mantener dos copias permanentes.

Ejemplo conceptual (sin valor de credencial):

```bash
export RESPALDOS_DIR="/ruta/externa/cifrada/respaldos-utm-desk"
export RESPALDOS_DESTINO_CIFRADO="confirmado"
# Cargar MONGODB_URI_RESPALDO desde el gestor de secretos autorizado.
bash backend/scripts/respaldo.sh
unset MONGODB_URI_RESPALDO
```

No se debe usar `backend/.env` ni la URI de la API para este procedimiento.

## 5. Respaldo manual

Desde la raíz del repositorio:

```bash
bash backend/scripts/respaldo.sh
```

El script:

1. Comprueba dependencias y compatibilidad con `--config`.
2. Exige las tres variables anteriores.
3. Resuelve `RESPALDOS_DIR` y rechaza rutas relativas, la raíz, `HOME` o
   cualquier ubicación dentro del repositorio.
4. Impide ejecuciones simultáneas y evita sobrescribir archivos del mismo día.
5. crea un YAML temporal protegido, sin imprimir su contenido.
6. Ejecuta `mongodump --db=utm_desk --archive=<temporal> --gzip --quiet`.
7. Exige salida no vacía, ejecuta `gzip -t` y calcula SHA-256.
8. Publica el archivo y su suma mediante enlaces atómicos que fallan si el
   destino ya existe.
9. Elimina configuración, logs y archivos parciales incluso ante interrupción.

Los errores producen un código distinto de cero y nunca muestran la URI ni el
mensaje interno de conexión de `mongodump`.

## 6. Nombre y archivos generados

La fecha se calcula en UTC:

```text
utm_desk_AAAAMMDD.archive.gz
utm_desk_AAAAMMDD.archive.gz.sha256
```

Por ejemplo, el 23 de octubre de 2026:

```text
utm_desk_20261023.archive.gz
utm_desk_20261023.archive.gz.sha256
```

El `.archive.gz` contiene el archivo de MongoDB comprimido. El `.sha256` permite
detectar alteraciones, pero no demuestra por sí mismo que el respaldo sea
restaurable.

## 7. Seguridad, cifrado y retención

- Los respaldos contienen hashes de contraseñas y potencialmente datos
  personales. Nunca se guardan en el repositorio, carpetas sincronizadas sin
  aprobación ni artefactos públicos.
- `.gitignore` bloquea por nombre los archivos y parciales de T-010 como defensa
  adicional. Aun así, `RESPALDOS_DIR` siempre debe estar fuera del clon.
- `gzip` es compresión, no cifrado. La confirmación
  `RESPALDOS_DESTINO_CIFRADO=confirmado` solo habilita la ejecución después de
  que el DBA verifica un volumen cifrado aprobado; no cifra el archivo por sí
  sola.
- Mantener como mínimo las últimas **cuatro semanas**. Esta tarea no implementa
  borrado automático para evitar eliminar la última copia válida.
- Crear un respaldo semanal y otro inmediatamente antes de cada migración,
  `collMod`, cambio de índices o esquema.
- Probar una restauración al menos una vez al mes y después de cambios relevantes
  de versión de MongoDB Database Tools.
- El respaldo cubre MongoDB. No copia los objetos de evidencias almacenados en
  Backblaze B2; estos requieren su propia política de recuperación.

## 8. Restauración local aislada

La restauración la realiza el DBA en una base local nueva. Nunca se restaura
sobre `utm_desk`, `utm_desk_test` ni producción, y no se usa `--drop` de forma
predeterminada.

Antes de comenzar:

1. Confirmar autorización y que `mongodb://localhost:27017` es realmente local.
2. Verificar que `utm_desk_restaurada` no contiene colecciones ni información
   que deba conservarse. Si contiene datos, detenerse y elegir otro nombre.
3. Confirmar la existencia del archivo y validar su suma desde el directorio de
   respaldos:

   ```bash
   sha256sum -c utm_desk_AAAAMMDD.archive.gz.sha256
   gzip -t utm_desk_AAAAMMDD.archive.gz
   ```

4. Ejecutar la restauración sustituyendo `ARCHIVO` por la ruta autorizada:

   ```bash
   ARCHIVO="/ruta/externa/cifrada/utm_desk_AAAAMMDD.archive.gz"
   mongorestore \
     --uri="mongodb://localhost:27017" \
     --archive="$ARCHIVO" \
     --gzip \
     --nsInclude='utm_desk.*' \
     --nsFrom='utm_desk.*' \
     --nsTo='utm_desk_restaurada.*' \
     --stopOnError
   ```

`--nsFrom` selecciona el namespace original y `--nsTo` lo renombra hacia la
base aislada. Si la base destino no está vacía, no añadir `--drop`: detenerse y
crear otra base local.

La copia restaurada sigue siendo información sensible. Debe conservar controles
de acceso, permanecer en el equipo autorizado y eliminarse posteriormente
mediante el procedimiento aprobado por el DBA, no mediante comandos improvisados.

## 9. Verificación y comparación de conteos

En el momento del respaldo, el DBA registra los conteos del origen desde una
sesión segura ya autenticada o desde la interfaz autorizada de Atlas. No debe
poner la URI en una línea de comandos ni copiar datos personales a la evidencia.

Después de restaurar, una sesión local de `mongosh` obtiene la lista real de
colecciones y sus conteos:

```javascript
const restaurada = db.getSiblingDB("utm_desk_restaurada");
restaurada.getCollectionNames().sort().forEach((nombre) => {
  print(`${nombre}: ${restaurada.getCollection(nombre).countDocuments({})}`);
});
```

Las colecciones actuales del repositorio son `incidencias_campus`, `usuarios`,
`roles` y `categorias`. Se debe usar la lista restaurada real para detectar
colecciones futuras y después completar:

| Colección | Origen al respaldar | Restaurada | Resultado |
|---|---:|---:|---|
| incidencias_campus | Pendiente | Pendiente | Pendiente |
| usuarios | Pendiente | Pendiente | Pendiente |
| roles | Pendiente | Pendiente | Pendiente |
| categorias | Pendiente | Pendiente | Pendiente |

Los conteos pueden diferir si se toman en momentos distintos mientras producción
recibe escrituras. Incluso si coinciden, también deben revisarse índices,
validadores, una muestra autorizada de documentos y los mensajes de
`mongorestore`; igualdad de conteos no demuestra equivalencia completa.

## 10. Frecuencia y relación con cambios de esquema

Orden obligatorio de BD-19:

1. Crear y verificar el respaldo.
2. Restaurarlo periódicamente en local.
3. Ejecutar la migración autorizada, si corresponde.
4. Aplicar `init_db.py` con la cuenta administrativa autorizada.
5. Verificar validadores e índices antes del despliegue.

La tarea T-007 mantiene su documentación técnica; este documento centraliza el
procedimiento periódico de T-010 sin modificar índices ni esquemas.

## 11. Plan de recuperación

Si el respaldo falla:

1. No aplicar migraciones ni cambios de esquema.
2. Conservar los respaldos anteriores.
3. Registrar únicamente el mensaje seguro, fecha, herramienta y código de salida.
4. Corregir permisos, espacio o versión de herramientas sin relajar controles.
5. Reintentar en una nueva ejecución; nunca renombrar un parcial como válido.

Si la restauración falla:

1. No usar el archivo como respaldo probado.
2. Conservar archivo, SHA-256 y logs seguros para diagnóstico del DBA.
3. Confirmar compatibilidad de versiones, espacio y namespace.
4. Crear un nuevo destino local vacío para el siguiente intento; no usar `--drop`
   sobre una base con información que deba conservarse.
5. Escalar al responsable antes de cualquier operación sobre producción.

## 12. Automatización futura con GitHub Actions

No se creó ni activó un workflow de producción. Antes de autorizarlo, el equipo
debe confirmar que el repositorio y los artefactos son privados, limitar permisos
del job, configurar el secreto `MONGODB_URI_RESPALDO`, resolver el acceso de red
sin `0.0.0.0/0`, cifrar antes de subir, restringir quién descarga y conservar al
menos cuatro semanas. Un artefacto de 14 días no cumple BD-24.

## 13. Plantilla de evidencia

| Campo | Valor |
|---|---|
| Fecha y hora UTC | Pendiente |
| Responsable autorizado | Pendiente |
| Resultado de `mongodump` | Pendiente |
| Nombre del archivo | Pendiente |
| Tamaño en bytes | Pendiente |
| SHA-256 | Pendiente |
| Destino cifrado aprobado | Sí / No |
| Fecha de restauración de prueba | Pendiente |
| Base local aislada utilizada | Pendiente |
| Resultado de `mongorestore` | Pendiente |
| Colecciones y conteos verificados | Pendiente |
| Observaciones no confidenciales | Pendiente |

La evidencia no debe incluir URI, credenciales, documentos, hashes de
contraseñas, rutas internas sensibles ni capturas con datos personales.
