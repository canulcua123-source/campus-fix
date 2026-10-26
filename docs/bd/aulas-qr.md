# T-012 · Catálogo de aulas y códigos QR

La colección `aulas` usa un `id_publico` aleatorio URL-safe de 22 caracteres
(128 bits), independiente del edificio o nombre del aula. MongoDB exige los
campos `id_publico`, `edificio`, `piso`, `aula`, `activa` y `fecha_creacion`.
Los índices únicos impiden repetir tanto el identificador como la ubicación.

## Preparar el catálogo

Genera un identificador una sola vez por aula:

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
