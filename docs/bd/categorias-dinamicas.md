# Categorías dinámicas (T-019)

T-019 permite administrar el catálogo de categorías sin habilitar todavía la creación de incidencias dinámicas. Las categorías `computo_redes`, `infraestructura` y `academico` son del sistema; se protegen por su clave y por `sistema: true` cuando esa marca existe. Las creadas mediante la API son personalizadas (`sistema: false`), comienzan activas y con `version: 1`.

## Contrato de definición

Cada categoría tiene `clave`, `nombre`, `prefijo`, `area_responsable` y entre 1 y 30 elementos en `campos`. La clave se normaliza a `snake_case`, sin acentos, con 3 a 30 caracteres. El prefijo contiene exactamente tres letras mayúsculas. Cada campo nuevo contiene `nombre`, `etiqueta`, `tipo` y `requerido`; su nombre se normaliza a `snake_case`, debe ser único y no admite `$`, `.`, operadores ni el nombre reservado `categoria`.

Los tipos administrables son `texto`, `numero`, `entero`, `booleano`, `ip` y `lista`. `min`/`max` representan longitud para `texto`, valores numéricos para `numero` y valores enteros para `entero`. `booleano` e `ip` no admiten límites. `lista` exige opciones de texto únicas y no admite límites. Los tipos históricos `enum` y `lista_texto`, además de `max_length` y `patron`, permanecen únicamente para leer y validar las categorías originales; el CRUD no los ofrece para categorías nuevas.

## API y versionado

- `GET /categorias`: cualquier usuario autenticado; conserva el listado de categorías activas ordenado por clave.
- `POST /categorias`: requiere `categorias:gestionar`; normaliza la clave, valida la definición y responde 201. La unicidad de clave se garantiza con el índice único de MongoDB.
- `PATCH /categorias/{clave}`: requiere `categorias:gestionar`; aplica solo campos enviados. Cambiar `campos` incrementa `version` de forma atómica y el filtro de versión evita sobrescrituras concurrentes. `activa: false` desactiva una categoría personalizada sin eliminarla.

Las categorías del sistema no admiten desactivación ni cambios de prefijo o campos. Pueden recibir cambios descriptivos en `nombre` y `area_responsable`. Los errores conservan el contrato global: 400 para definición inválida, 401 sin autenticación, 403 sin permiso, 404 si la clave no existe y 409 para duplicados, concurrencia o una operación protegida.

## MongoDB y alcance posterior

`backend/scripts/init_db.py` sigue siendo la fuente única del `$jsonSchema`, con `validationLevel: strict`, `validationAction: error`, semillas idempotentes e índice único de `clave`. El esquema amplía `categorias` sin exigir metadatos nuevos a documentos históricos. Su aprobación y aplicación corresponden al DBA; T-019 no ejecuta `collMod` ni usa Atlas.

T-020 deberá validar `detalle_especifico` con estas definiciones, guardar `categoria_version`, administrar su caché y decidir el índice wildcard. Hasta entonces, una categoría nueva puede administrarse en el catálogo, pero no utilizarse para crear incidencias.
