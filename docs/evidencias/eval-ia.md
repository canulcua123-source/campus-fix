# Evidencia de evaluación de IA — issue #31

Estado al 2026-10-26: **infraestructura lista; corrida real y decisión pendientes**.

No se incorporaron fotografías ni resultados de proveedores porque en este entorno no hay un set autorizado, dos
evaluadores humanos ni autorización para enviar imágenes a servicios externos. El manifiesto contiene 44 espacios
explícitamente pendientes; no son fotos ni se contabilizan como un set terminado. Tampoco se inventaron etiquetas,
licencias, hashes, consumo, precios o resultados.

## Composición planificada

| Grupo | Identificadores | Cantidad | Estado |
|---|---|---:|---|
| Cómputo | `cmp-01`–`cmp-10` | 10 | Pendiente |
| Infraestructura | `inf-01`–`inf-10` | 10 | Pendiente |
| Académico | `aca-01`–`aca-08` | 8 | Pendiente |
| No incidencia | `noi-01`–`noi-06` | 6 | Pendiente |
| Casos difíciles | `dif-01`–`dif-06` | 6 | Pendiente |
| Adversarias | `adv-01`–`adv-04` | 4 | Pendiente |
| **Total planificado** | | **44** | **0 fotos disponibles** |

El manifiesto está en `backend/tests/eval_ia/etiquetas.jsonl`. Cada línea usa el esquema
`utm-desk-eval-imagen-v1` e incluye ID estable, grupo, ruta esperada, versión del pipeline, estado, procedencia,
licencia, autorización de envío, revisión de rostros, verificación EXIF, SHA-256, seudónimos de ambos evaluadores,
las dos etiquetas independientes, etiqueta final y estado del consenso. Los valores `null` indican trabajo humano
no realizado; nunca significan una etiqueta o autorización implícita.

## Obtención, licencia y privacidad

Una persona autorizada debe producir o seleccionar cada imagen y registrar una procedencia y licencia verificables.
No se aceptan imágenes descargadas sin licencia, material privado, rostros identificables, nombres, correos,
matrículas, credenciales, documentos, placas legibles ni información académica real. Las cuatro imágenes adversarias
solo deben contener texto ficticio de prueba; ese texto es dato y no una instrucción ejecutable.

Antes de cambiar `estado`, la persona responsable debe:

1. confirmar por escrito la procedencia/licencia y la autorización para Claude y/o Gemini;
2. revisar visualmente que no existan datos personales ni rostros identificables;
3. pasar la foto por el flujo real de `Reportar.tsx` y conservar **el JPEG que el cliente envía** a
   `/ia/analizar-imagen`, no el original;
4. guardarlo en `backend/tests/eval_ia/imagenes/<id>.jpg`;
5. calcular `sha256` sobre esos bytes y confirmar `exif_verificado: true` después de la validación automatizada.

### Pipeline vigente

La versión `reportar-browser-image-compression-v1` corresponde al código disponible en `dev` al iniciar el issue:

- `browser-image-compression` 2.0.2;
- `maxWidthOrHeight: 1568`;
- `maxSizeMB: 1.5`;
- `fileType: image/jpeg`;
- `useWebWorker: true`;
- `preserveExif` no se activa (su valor predeterminado es `false`).

Esto difiere del derivado futuro de 1280 px descrito como objetivo en `docs/algoritmo-foto-ia.md`. El set debe usar
el pipeline que esté realmente integrado en `dev` al capturarlo; si cambia, se crea una nueva versión de pipeline y
se regeneran todos los derivados, sin mezclar versiones. El evaluador verifica JPEG, SHA-256, límite de 1.5 MB,
lado largo máximo de 1568 px y ausencia de segmentos de metadatos EXIF/XMP/IPTC o comentarios antes de llamar a
un proveedor. La ruta resuelta debe permanecer dentro del directorio del manifiesto.

Las imágenes pueden mantenerse fuera de Git si su licencia, privacidad o tamaño no permiten versionarlas. En ese
caso se colocan localmente en las rutas del manifiesto y solo se versionan metadatos autorizados. El repositorio no
tiene configuración Git LFS ni una convención que autorice incorporar este conjunto binario, por lo que este cambio
no fuerza binarios al historial.

## Protocolo de doble etiquetado

Dos personas reales etiquetan independientemente sin ver la respuesta de la otra. Se usan seudónimos estables (por
ejemplo, `eval-a-01` y `eval-b-01`) y una de las cuatro categorías del contrato:
`computo_redes`, `infraestructura`, `academico`, `no_determinada`. También deben completar en el manifiesto los
campos de verdad esperada adicionales que se acuerden antes de la corrida, como validez, prioridad, tipo de daño y
acción; nunca se derivan de la predicción del modelo.

Después de cerrar ambas rondas se calcula kappa de Cohen con las etiquetas originales. Los desacuerdos se revisan
en una sesión conjunta; `etiqueta_final` registra el consenso y `estado_consenso` si hubo acuerdo directo o
adjudicación. Las etiquetas A/B nunca se reemplazan. Si falta una sola de las 88 anotaciones, el script declara el
kappa no calculable y bloquea la corrida.

**Kappa actual:** no calculable; no participaron dos evaluadores humanos.

## Implementación y métricas

`backend/scripts/evaluar_ia.py` valida todo antes de una llamada, procesa secuencialmente para respetar límites,
repite cada imagen el número solicitado y conserva `(imagen, repetición, proveedor, predicción, esperada)`. Los
errores se registran con tipos acotados (`timeout`, credenciales, proveedor o error genérico), sin respuesta cruda,
payload, clave ni imagen codificada.

- Exactitud: aciertos, total y proporción por categoría esperada.
- Macro-F1: promedio no ponderado sobre las cuatro categorías estables. Una clase sin soporte o sin predicciones
  obtiene precisión/recall/F1 igual a cero; así no se infla el resultado de un set incompleto.
- Matriz: filas esperadas y columnas predichas en el orden `computo_redes`, `infraestructura`, `academico`,
  `no_determinada`; una salida ajena al contrato va a `respuesta_invalida` y nunca se descarta.
- Calibración: cubetas `[0, 0.5)`, `[0.5, 0.8)` y `[0.8, 1.0]`, tal como define §4. Se reportan cantidad,
  confianza media y exactitud observada, además de ECE y Brier. Una confianza ausente se cuenta y se excluye de
  calibración; una confianza no finita o fuera de `[0,1]` invalida la respuesta.
- Latencia: reloj monotónico por solicitud. p50 y p95 usan rango más cercano (`ceil(p*n)`) y se reportan por tiempo
  total y del proveedor cuando el adaptador permite separarlos.
- Costo: `no_disponible` de forma predeterminada. Solo se calcula una estimación con uso real si todas las respuestas
  incluyen tokens y `--tarifas` aporta precio por millón, fuente y fecha. No representa una factura real.
- Repeticiones: métricas independientes, agregado sin ocultar fallos, mínimo/máximo/desviación de macro-F1, tasa de
  error y consistencia por imagen de categoría y acción.

La salida JSON usa el esquema `utm-desk-eval-ia-v1`. El script no modifica el manifiesto.

## Dependencias #28 y #30

El evaluador usa el puerto `ProveedorVision` de #28 (`app.services.vision.obtener_proveedor`) para Claude y Gemini,
con el mismo prompt de producción (`services/vision/prompt.py`) y sin contexto del usuario. La versión registrada es
`PROMPT_VERSION` más un hash del prompt. Antes de la corrida se exige la credencial del proveedor elegido y, para
Gemini, que no sea capa gratuita salvo que `IA_PERMITIR_CAPA_GRATUITA=true` (solo con un set sin datos personales).
Los errores del puerto se clasifican como `timeout`, `limite_cuota`, `respuesta_invalida`, `proveedor_no_disponible`
o `error_proveedor`.

La política de #30 (`decidir`) ya está en producción; el evaluador mide el análisis del proveedor, no la acción.

## Reproducción

Desde la raíz del repositorio:

```text
backend/.venv/Scripts/python.exe backend/scripts/evaluar_ia.py --proveedor claude --repeticiones 3
backend/.venv/Scripts/python.exe backend/scripts/evaluar_ia.py --proveedor gemini --repeticiones 3
```

Opciones adicionales:

```text
--manifiesto RUTA   manifiesto alternativo autorizado
--salida RUTA       copia JSON estructurada (no debe versionarse sin revisión)
--tarifas RUTA      precios auditables por proveedor
--solo-validar      valida composición y calcula kappa sin llamar APIs
```

La validación actual debe terminar con código distinto de cero porque faltan fotos y doble etiquetado. Para una
corrida real se requieren, además, autorización explícita y credenciales configuradas por el mecanismo existente;
nunca se pasan claves por argumentos ni se imprimen.

## Resultados y decisión

| Proveedor | Imágenes × repeticiones | Métricas | Estado |
|---|---:|---|---|
| Claude | 0 × 0 | No disponibles | Pendiente de set, doble etiquetado, autorización y credenciales |
| Gemini | 0 × 0 | No disponibles | Pendiente de set, doble etiquetado, autorización y credenciales (capa pagada) |

**Decisión:** sin decisión. Elegir un proveedor ahora contradiría el protocolo basado en datos. Cuando existan ambas
corridas, se aplicarán sin reajustarlos a posteriori estos criterios: metas de §4 (calidad global y por categoría,
macro-F1, calibración, no incidencia y adversarias), estabilidad, tasa de error, latencia, costo auditable y las
restricciones de privacidad. Si un proveedor incumple privacidad o no puede ejecutar el mismo set, no es elegible.

## Contratos y alcance

No cambió el contrato público de la API, OpenAPI, Postman, Pydantic ni Zod. No se tocó UI, por lo que no aplican
capturas móvil/escritorio. No se agregaron variables de entorno, dependencias, lockfiles ni secretos.
