# AGENTS.md — Guía para agentes que ejecutan las fases

> Este archivo es la **guía operativa** para cualquier agente (AI o humano) que tome una
> fase de [`specs/todo/begin/`](specs/todo/begin/). Los specs de [`specs/`](specs/) son
> **normativos**: si el código los contradice, manda el spec.

---

## 1. Cómo se trabaja una fase

1. **Elegí la fase más baja pendiente** (`00`, `01`, `02`, …). No arranques una fase si la
   anterior no está cerrada salvo que la fase lo permita explícitamente.
2. **Leé completa la fase** y los specs que referencia.
3. **Hacé las preguntas y pedí permisos al inicio** (ver §2).
4. **Implementá todos los checkpoints**. No dejes puntos `[ ]` sin marcar sin justificar.
5. **Verificá** con los comandos de la fase y completá el *Definition of Done*.
6. **Actualizá** el estado de la fase (marcar `[x]`, agregar fecha) y el roadmap del README raíz.
7. **Commit** directo en `main` (ver §4). Push sólo si el usuario lo autoriza.

---

## 2. Preguntas y permisos al inicio (obligatorio)

Al inicio de **cada** fase, antes de escribir código:

1. Presentá al usuario la lista de **preguntas** de la sección *"0. Preguntas y permisos"*
   de la fase.
2. Presentá la lista de **permisos** que necesitás (instalar dependencias, levantar
   Docker, descargar PDFs externos, inicializar git, push, etc.).
3. **Esperá respuesta.** Si no hay respuesta tras un tiempo razonable, **asumí los valores
   por defecto documentados en la fase** y dejalo explícito en el mensaje de commit.
4. Nunca ejecutes acciones destructivas (`docker compose down -v`, `rm -rf`, `dropDatabase`)
   sin permiso explícito.

> Plantilla de mensaje:
>
> ```text
> ## Fase NN — <nombre>
> Preguntas:
>   1. ...
> Permisos que necesito:
>   - [ ] ...
> Si no hay respuesta, continúo con los valores por defecto indicados en la fase.
> ```

---

## 3. Reglas técnicas (no negociables)

- TypeScript **estricto**; prohibido `any` explícito.
- **Sin mocks** en código productivo. En tests, los dobles viven sólo en `*.spec.ts`/`test/`.
- **Una única conexión Mongoose** (`MongooseModule.forRoot`); prohibido abrir conexiones
  sueltas o usar `mongoose.connect()` por fuera del módulo de base de datos.
- **Una fila = un objeto plano**. Nunca anidar objetos arbitrarios dentro de `rows` salvo que
  el tipo de columna sea `json` explícitamente.
- Los **importes de PDF se descargan en runtime**, nunca se commitean al repo.
- **El esquema (`schema`) de un dataset es la fuente de verdad** de los tipos: el endpoint
  dinámico **valida contra el esquema**, nunca confía en el query string.
- **Nada de `eval`, `Function()`, ni consultas NoSQL construidas por concatenación de
  strings** recibidas del usuario. Los filtros se resuelven desde un allowlist del
  `EndpointDefinition`.
- **Versionado inmutable**: una ingesta nueva **nunca** muta un `Dataset` existente; crea
  `version + 1`.
- Secretos sólo en variables de entorno validadas al arranque; jamás en el repo.
- El **frontend (`apps/web`) es un cliente de la API**, no una segunda capa de negocio: no
  accede a MongoDB y las columnas y filtros se generan desde `schema` y `EndpointDefinition`,
  nunca hardcodeados.
- La UI está **inspirada en** Horizon UI Tailwind CSS NextJS, pero el código es propio: sin
  paquetes `@horizon-ui/*` ni código copiado del template.

Detalle normativo en [`specs/conventions.md`](specs/conventions.md),
[`specs/architecture.md`](specs/architecture.md) y [`specs/frontend.md`](specs/frontend.md).

---

## 4. Git: ramas, commits y push

- **Remoto:** `https://github.com/dzCazador/DatosApi-DataSetCatalog.git`. Rama por defecto:
  `main`. El repo se inicializa en la **fase 00**.
- **Se trabaja únicamente sobre `main`.** Decisión del owner (2026-10-01): **no** se crean
  ramas `fase/NN-*` ni Pull Requests; cada fase se commitea directo en `main` y se pushea al
  cerrar. La rama `fase/01-bootstrap-monorepo` fue mergeada y eliminada como consecuencia de
  este cambio.
  - Antes de arrancar cada fase: `git checkout main && git pull --ff-only`.
  - Commits por fase, sin mixing: `feat: phase NN — <short summary>`.
  - Nunca force-push; nunca push a otra rama.
- **Conventional Commits**, y **el mensaje siempre en inglés**:

```text
feat:    nueva funcionalidad
fix:     corrección de bug
refactor: refactor sin cambio de comportamiento
chore:   tooling, dependencias, infra
docs:    documentación y specs
test:    tests
ci:      pipelines
perf:    performance
```

| Alcance | Ejemplo |
|---|---|
| Con scope | `feat(api): add pdf table extractor` |
| Cierre de fase | `feat: phase 05 — pdf ingestion` |

- Los mensajes son **una línea, imperativo, conciso** (≤ 72 caracteres). Detalle extra en el
  cuerpo sólo si hace falta.
- Antes de commitear: `pnpm lint && pnpm typecheck && pnpm build` (y `pnpm test` si existe).
- **Push siempre** al cerrar la fase:

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "feat: phase NN — <short summary>"
git push origin main
```

- **Nunca** commitear secretos, `.env`, binarios descargados ni PDFs (`storage/` está
  gitignored). Si el push falla por credenciales, dejar el commit local y documentar el
  bloqueo (nunca force-push).

---

## 5. Definición de terminado (DoD) de una fase

- [ ] Todos los checkpoints marcados o justificados.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` y `pnpm test` en verde (si existen).
- [ ] Fase marcada como completada con fecha en su archivo y en el roadmap del README.
- [ ] Commit creado y pusheado en `main`.
- [ ] Pendientes y decisiones anotados en la fase para la siguiente.

---

## 6. Contexto del producto

DatosApi **centraliza datos de terceros y los publica como endpoints REST propios**. El
usuario aporta la fuente (API, URL, PDF o carga manual), el sistema la ingiere, la normaliza
y la versiona, y expone un endpoint dinámico configurable sin tocar código.

El caso de referencia es la **Escala de Retención de Ganancias 4ª Categoría** publicada por
AFIP en PDF, pero el diseño **no** es específico de AFIP: el dominio es
`Source → Dataset → EndpointDefinition`.

Ver [`specs/README.md`](specs/README.md) y [`specs/architecture.md`](specs/architecture.md).