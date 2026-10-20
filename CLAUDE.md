# CLAUDE.md

**Lee y sigue [`AGENTS.md`](AGENTS.md)** antes de hacer cualquier cambio. Sus reglas tienen prioridad sobre el chat.

Las 5 reglas críticas:

1. Nunca hagas commit, push ni merge en `dev` o `main`; trabaja en `<tipo>/<issue>-<slug>` desde `dev` y nunca uses `push --force` (solo `--force-with-lease` en tu rama).
2. Nunca te conectes a MongoDB Atlas ni uses el `backend/.env` real: solo Docker local. Nunca `drop`, `drop_database` ni `delete_many({})`.
3. Cambios de esquema solo en `backend/scripts/init_db.py`, y en el mismo PR actualiza Pydantic, pruebas y Postman.
4. Toda consulta a `incidencias_campus` lleva `filtro_alcance(usuario)` y todo endpoint `require_permiso(...)`.
5. No desactives pruebas, validaciones ni límites de seguridad para que algo "pase"; corre `ruff check`, `pytest tests -q`, `npm run lint` y `npm run build` antes de proponer el PR.
