# Fase 02 — Backend base: NestJS, config, Swagger y salud

> **Objetivo:** tener `apps/api` arrancando, con configuración validada, OpenAPI y health
> check contra MongoDB.

**Spec de referencia:** [`stack.md`](../../stack.md) §2, [`conventions.md`](../../conventions.md) §3, §4.

**Estado:** ✅ completada el **2026-10-01**.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **Adaptador HTTP.** Default: **Express** (`@nestjs/platform-express`), por coherencia con
   SueldoNext. Fastify queda como opción si se prioriza performance.
2. **¿Health check como dependencia?** Default: sí, con `@nestjs/terminus` (misma elección que
   SueldoNext).
3. **Prefijo global de rutas.** Default: `/api/v1` desde `API_PREFIX`.

### Permisos a solicitar

- [x] `pnpm install` en `apps/api` y `packages/database`.
- [x] Conectar la app a MongoDB local (ya levantado en fase 01).

### Valores por defecto si no hay respuesta

- Express + terminus + `/api/v1`.

---

## 1. Crear `apps/api`

- [x] `package.json` con scripts `build`, `dev`, `lint`, `typecheck`, `test`, `start:prod`
  (+ `test:e2e`).
- [x] Dependencias: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`,
  `@nestjs/config`, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/mongoose`, `mongoose`,
  `joi`, `class-validator`, `class-transformer`, `reflect-metadata`, `rxjs`.
- [x] Dev: `@nestjs/cli`, `@nestjs/testing`, `@types/node`, `@types/jest`, `@types/supertest`,
  `@types/express`, `eslint`, `prettier`, `jest`, `ts-jest`, `supertest`, `typescript`,
  `typescript-eslint`.
- [x] `tsconfig.json` extendiendo `../../tsconfig.base.json` + `tsconfig.build.json`.
- [x] `nest-cli.json`, `eslint.config.mjs` (flat config), `.prettierrc` (heredada de la raíz).
- [x] Configuración de Jest en `package.json` (`rootDir: src`, `testRegex: .*\.spec\.ts$`).

## 2. Bootstrap de la aplicación

- [x] `main.ts`: `setGlobalPrefix` con exclusión de `/health`, `ValidationPipe` global con
  `whitelist` + `forbidNonWhitelisted` + `transform`, `HttpExceptionFilter` global,
  `SwaggerModule.setup('docs', ...)`, `enableShutdownHooks()`.
- [x] `app.module.ts` importa `ConfigModule.forRoot({ isGlobal: true, validationSchema })`,
  `DatabaseModule.forRoot()` y `HealthModule`.
- [x] CORS con `CORS_ORIGINS` (comodín `*` o lista separada por comas).

## 3. Configuración por entorno

- [x] `src/config/configuration.ts`: lee `NODE_ENV`, `API_PORT`, `API_PREFIX`,
  `CORS_ORIGINS`, `MONGODB_URI`, `INGEST_*`, `DEFAULT_LIMIT`, `MAX_LIMIT`, `PREVIEW_ROWS`,
  `STORAGE_DIR`.
- [x] `src/config/env.validation.ts` con Joi: puerto numérico, `MONGODB_URI` requerido,
  `INGEST_MAX_ROWS > 0`, `0 < DEFAULT_LIMIT ≤ MAX_LIMIT` (y `PREVIEW_ROWS ≤ MAX_LIMIT`).
- [x] **Falla rápido**: si el env es inválido, la app no arranca (log de Nest con el detalle de
  Joi).
- [x] `src/config/env-file-path.ts`: el `.env` vive en la raíz del monorepo y cada workspace
  corre con su propio `cwd`, así que se busca hacia arriba.

## 4. Health

- [x] `src/health/health.controller.ts` con `GET /health` usando `Terminus`: ping de Mongo.
- [x] `200 { status: "ok", uptime, database: { status, ping } }`; `503` si Mongo no responde.
- [x] `src/health/database-health.indicator.ts`: ping real (`admin().ping()`) para que `ping`
  sea la latencia de ida y vuelta.

## 5. Errores uniformes

- [x] `src/common/errors/error-code.ts`: los 20 códigos de
  [`api-contract.md`](../../api-contract.md) §1.2 más `INTERNAL_ERROR`, `ROUTE_NOT_FOUND` y
  `HTTP_ERROR` (transversales, fuera de la tabla del contrato).
- [x] `src/common/errors/domain.exception.ts`: `DomainException extends HttpException` con
  `code` + `message` + `details`.
- [x] `src/common/filters/http-exception.filter.ts`: único filtro global; responde
  `{ statusCode, code, message, details, path, timestamp }`.

## 6. Criterios de aceptación

- [x] `pnpm dev` levanta la API en `:3001` (verificado con `turbo run dev`: `@datosapi/database`
      compila en watch y `@datosapi/api` arranca con `nest start --watch`).
- [x] `curl localhost:3001/health` → `200 {"status":"ok","uptime":11,"database":{"status":"up","ping":4.64}}`.
- [x] `curl localhost:3001/docs` → Swagger UI (`200`); el JSON está en `/docs-json`.
- [x] Apagar Mongo (`docker compose stop mongo`) → `/health` devuelve `503` con
      `{"status":"error","database":{"status":"down","ping":null,"message":"connect ECONNREFUSED …"}}`
      y vuelve a `200` al levantarlo.
- [x] Env inválido → la app no arranca con log claro
      (`Config validation error: DEFAULT_LIMIT no puede ser mayor que MAX_LIMIT`,
      `"API_PORT" must be a number`, `"MONGODB_URI" must be a valid uri…`).
- [x] `pnpm lint && pnpm typecheck && pnpm build && pnpm test` en verde.

### Tests agregados

| Suite | Qué cubre |
|---|---|
| `src/config/env.validation.spec.ts` | Defaults, `MONGODB_URI` requerido, puerto, prefijo, `DEFAULT_LIMIT ≤ MAX_LIMIT`, variables ajenas ignoradas |
| `src/config/configuration.spec.ts` | Parseo de `CORS_ORIGINS`, coerción a `number`, fallo si falta o no es numérico |
| `src/common/filters/http-exception.filter.spec.ts` | `DomainException` conserva el `code`; 400 de `ValidationPipe` → `VALIDATION_ERROR` + `details`; 404 sin `code` → `ROUTE_NOT_FOUND`; error inesperado → `INTERNAL_ERROR` sin filtrar el mensaje |
| `src/health/database-health.indicator.spec.ts` | `up` con latencia, `down` con mensaje del driver, `down` sin conexión |
| `src/health/health.controller.spec.ts` | `200` con `ok`, `503` con `error`, resultado de terminus sin indicador |
| `test/health.e2e-spec.ts` | `GET /health` `200` contra el Mongo real de `pnpm infra:up`; `/api/v1/health` `404` |

## 7. Commit y push

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "feat: phase 02 — nestjs backend base"
git push origin main
```

Sin rama `fase/02-*` ni Pull Request: por la decisión del owner (2026-10-01) cada fase se
commitea directo en `main`.

## 8. Estado y decisiones

- Fecha de ejecución: **2026-10-01**
- Adaptador HTTP: **Express**; health: **Terminus**; prefijo: **`/api/v1`** (los tres defaults
  de la fase).
- **Versiones fijadas a las del spec `stack.md`**, no a las últimas: NestJS 11.2, Mongoose 8.24,
  `@nestjs/config` 4, `@nestjs/swagger` 11, `@nestjs/terminus` 11, `joi` 18, ESLint 9. El
  registry ya publica NestJS 12 / Mongoose 9 / ESLint 10; migrar es una decisión posterior,
  no un accidente de instalación.
- **`/health` queda fuera del preijo global** (`setGlobalPrefix(prefix, { exclude: [health] })`):
  es lo que piden [`api-contract.md`](../../api-contract.md) §2 y los criterios de aceptación de
  esta fase. Swagger queda en `/docs` por el mismo motivo.
- **Indicador de Mongo propio** en vez del `MongooseHealthIndicator` de terminus: el built-in
  sólo mira `readyState === 1` y no devuelve latencia, y el contrato exige `ping`. Se usa la
  API vigente de terminus (`HealthIndicatorService`), no la clase `HealthIndicator` (deprecada
  en v11).
- **`@Res({ passthrough: true })` en el controller de health**: el contrato pide el cuerpo de
  salud también en el `503`, no la forma de error uniforme. El resto de la API sigue hablando
  con excepciones y el filtro global.
- **Códigos `ROUTE_NOT_FOUND`, `HTTP_ERROR` e `INTERNAL_ERROR`**: los tres son transversales y
  no figuran en la tabla §1.2 del contrato; `INTERNAL_ERROR` ya lo pedía
  [`conventions.md`](../../conventions.md) §4.2.
- **`apps/api/src/common/`**: carpeta nueva para filtro, códigos y `DomainException`
  (`DomainException` extiende `HttpException`, así que es de la capa HTTP y no de
  `packages/common`). Se actualizó el árbol de [`architecture.md`](../../architecture.md) §3.
- **Alias de TS**: cada `tsconfig.build.json` sobrescribe `paths: {}`. Con los `paths` de la
  raíz, `tsc` arrastra el `src` del paquete vecino al programa y la raíz común de emisión sube a
  la raíz del monorepo (`dist/apps/api/src/main.js`). El `tsconfig.json` de cada paquete sí
  conserva los `paths`: typecheck y editor resuelven contra el fuente, el build contra el
  `dist` del workspace.
- **`@typescript-eslint/consistent-type-imports` desactivado** (con el porqué anotado en
  `eslint.config.mjs`): convertía a `import type` las clases que Nest sólo usa como tipo en el
  constructor y eso borraba el `design:paramtypes` del que depende la inyección.
- `strictPropertyInitialization: false` sólo en `apps/api`: es el default de Nest para DTOs con
  decoradores. `strictNullChecks`, `noUncheckedIndexedAccess` y `noImplicitOverride` siguen
  activos en la raíz.
- `turbo.json`: la task `dev` ahora depende de `^build` para que `packages/database` esté
  compilado antes de que arranque la API.
- `serverSelectionTimeoutMS: 5000` en la conexión: sin él, una caída de Mongo deja requests
  colgados hasta el timeout del balanceador.

### Pendientes para la fase 03

- `packages/database` todavía **no tiene script `test`**: la fase 03 agrega repositorios con
  tests y debe incorporar `jest`/`ts-jest` ahí.
- Los repositorios necesitarán los esquemas y `src/common` seguirá creciendo; si el volumen de
  errores de dominio lo justifica, el filtro y los códigos pueden moverse a `packages/common`
  (requiere que deje de depender de `@nestjs/common`).
- `pnpm format:check` sigue marcando 5 archivos de las fases 00/01 (`docker-compose.yml`,
  `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json`). Son sólo
  whitespace: conviene un `chore: format root files` aparte para no ensuciar la fase.
- El e2e de health **requiere MongoDB levantado** (`pnpm infra:up`); en CI (fase 08) habrá que
  decidir entre un service container o `mongodb-memory-server`.