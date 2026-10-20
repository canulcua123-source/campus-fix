<!-- Título del PR en Conventional Commits:  feat(api): agrega filtro por estado -->

## Issue

Closes #<!-- número del issue (obligatorio para PR a dev; 1 PR = 1 issue) -->

## Qué cambia

<!-- 2-5 viñetas: qué hace este PR y por qué. -->

-

## Cómo probar

<!-- Pasos exactos para que el revisor lo verifique (comandos, endpoint, pantalla). -->

1.

## Checklist

- [ ] Mi rama sale de `dev` y está rebasada sobre `origin/dev` (`git rebase origin/dev`).
- [ ] Agregué o actualicé pruebas (`pytest tests -q` en backend / `npm run build && npm run lint` en frontend) y pasan en local.
- [ ] No hay secretos, `.env`, tokens ni URIs reales en el código, logs, capturas o descripción.
- [ ] Respeté las reglas de BD de `AGENTS.md`: sin `drop`/`delete_many({})`, cambios de esquema solo en `scripts/init_db.py` (+ Pydantic + pruebas), `filtro_alcance` en consultas de incidencias, sin `null`.
- [ ] Contrato de API actualizado si cambió (colección de `postman/` y `docs/`), o no aplica.
- [ ] El PR es pequeño (≈ 400 líneas cambiadas o menos, sin contar lockfiles) y toca un solo tema.

### Si toca frontend

- [ ] Usé los tokens de `src/styles/tokens.css` (sin colores/espaciados sueltos).
- [ ] Estados de carga, vacío y error diseñados; funciona en móvil (360 px) y escritorio.
- [ ] Formularios validados con Zod espejo del esquema Pydantic.
- [ ] Capturas antes/después:

<!-- arrastra aquí las capturas -->

## Uso de IA

- [ ] **No** usé IA en este PR.
- [ ] **Sí** usé IA (herramienta: ______ ) y **revisé el código línea por línea**; entiendo y puedo explicar cada cambio.
