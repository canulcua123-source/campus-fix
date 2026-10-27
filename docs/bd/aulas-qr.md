# T-012 · Catálogo de aulas y códigos QR

La colección `aulas` usa un `id_publico` aleatorio URL-safe de 22 caracteres
(128 bits), independiente del edificio o nombre del aula. MongoDB exige los
campos `id_publico`, `edificio`, `piso`, `aula`, `activa` y `fecha_creacion`.
Los índices únicos impiden repetir tanto el identificador como la ubicación.

## Alta manual desde la app (RF-ADM-04, issue #138)

Las aulas se registran desde **Admin → Edificios** con el botón «Nueva aula»
(edificio, piso, aula y si está activa). La API (`POST /aulas`, permiso
`usuarios:gestionar`) genera el `id_publico` y guarda `fecha_creacion` en UTC;
repetir edificio + piso + aula responde 409. Desde la misma pantalla se edita
cada aula (`PATCH /aulas/{id_publico}`) y se activa o desactiva: una aula
inactiva no aparece en `GET /aulas/ubicaciones` y su QR responde 404. Editar
nunca cambia el `id_publico`, así que los QR impresos siguen funcionando. Cada
alta o edición queda en la bitácora (`auditoria`, recurso `aulas`) solo con
edificio, piso, aula y activa.

**El `id_publico` que muestra la app (columna «ID del QR», botón copiar) es el
que va en la URL del QR.** Para imprimir las imágenes, arma el CSV de abajo con
esos identificadores y usa el generador; ya no hace falta `nuevo-id` para aulas
dadas de alta en la app.

## Preparar el catálogo (CSV para el generador de QR)

Para un aula que aún no existe en la app, el generador también puede crear un
identificador (la carga en MongoDB se hace igualmente desde la app o por una
operación autorizada):

```powershell
python scripts/generar_qr_aulas.py nuevo-id
```

Guarda el catálogo controlado fuera del repositorio como CSV UTF-8 con estas
columnas exactas:

```csv
id_publico,edificio,piso,aula
AbCdEfGhIjKlMnOpQrStUv,A,2,A-201
```

La carga del catálogo en MongoDB es una operación administrativa separada y
autorizada. El generador no se conecta a MongoDB ni inserta documentos.

## Generar imágenes

```powershell
python scripts/generar_qr_aulas.py generar aulas.csv `
  --base-url https://pwa.example.edu `
  --salida D:\qr-campus
```

El dominio no está hardcodeado. HTTP solo se admite para localhost. El script
rechaza columnas inesperadas, identificadores o ubicaciones repetidas, rutas
inválidas y archivos existentes. Para reemplazar imágenes deliberadamente se
requiere `--sobrescribir`.

Cada imagen codifica `https://DOMINIO/reportar?aula=ID_OPACO`. La API resuelve
el identificador mediante `GET /aulas/{id}` para usuarios autenticados con el
permiso existente `incidencias:crear`; nunca devuelve `_id` de MongoDB.
