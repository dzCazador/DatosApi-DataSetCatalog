# Fase 02 — Backend base: NestJS, config, Swagger y salud

> **Objetivo:** tener `apps/api` arrancando, con configuración validada, OpenAPI y health
> check contra MongoDB.

**Spec de referencia:** [`stack.md`](../../stack.md) §2, [`conventions.md`](../../conventions.md) §3, §4.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **Adaptador HTTP.** Default: **Express** (`@nestjs/platform-express`), por coherencia con
   SueldoNext. Fastify queda como opción si se prioriza performance.
2. **¿Health check como dependencia?** Default: sí, con `@nestjs/terminus` (misma elección que
   SueldoNext).
3. **Prefijo global de rutas.** Default: `/api/v1` desde `API_PREFIX`.

### Permisos a solicitar

- [ ] `pnpm install` en `apps/api`.
- [ ] Conectar la app a MongoDB local (ya levantado en fase 01).

### Valores por defecto si no hay respuesta

- Express + terminus + `/api/v1`.

---

## 1. Crear `apps/api`

- [ ] `package.json` con scripts `build`, `dev`, `lint`, `typecheck`, `test`, `start:prod`.
- [ ] Dependencias: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`,
  `@nestjs/config`, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/mongoose`, `mongoose`,
  `joi`, `class-validator`, `class-transformer`, `reflect-metadata`, `rxjs`.
- [ ] Dev: `@nestjs/cli`, `@nestjs/testing`, `@types/node`, `@types/jest`, `@types/supertest`,
  `eslint`, `prettier`, `jest`, `ts-jest`, `supertest`, `typescript`, `typescript-eslint`.
- [ ] `tsconfig.json` extendiendo `../../tsconfig.base.json` + `tsconfig.build.json`.
- [ ] `nest-cli.json`, `eslint.config.mjs` (flat config), `.prettierrc`.
- [ ] Configuración de Jest en `package.json` (como en SueldoNext: `rootDir: src`,
  `testRegex: .*\\.spec\\.ts$`).

## 2. Bootstrap de la aplicación

- [ ] `main.ts`:

```ts
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(configService.getOrThrow<string>('API_PREFIX'));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalFilters(new HttpExceptionFilter());
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(configService.getOrThrow<number>('API_PORT'));
}
```

- [ ] `app.module.ts` importa `ConfigModule.forRoot({ isGlobal: true, validationSchema })`,
  `DatabaseModule` y `HealthModule`.
- [ ] CORS con `CORS_ORIGINS`.

## 3. Configuración por entorno

- [ ] `src/config/configuration.ts`: lee `NODE_ENV`, `API_PORT`, `API_PREFIX`,
  `CORS_ORIGINS`, `MONGODB_URI`, `INGEST_*`, `DEFAULT_LIMIT`, `MAX_LIMIT`, `PREVIEW_ROWS`,
  `STORAGE_DIR`.
- [ ] `src/config/env.validation.ts` con Joi: puerto numérico, `MONGODB_URI` requerido,
  `INGEST_MAX_ROWS > 0`, `0 < DEFAULT_LIMIT ≤ MAX_LIMIT`.
- [ ] **Falla rápido**: si el env es inválido, la app no arranca.

## 4. Health

- [ ] `src/health/health.controller.ts` con `GET /health` usando `Terminus`: ping de Mongo.
- [ ] `200 { status: "ok", uptime, database: { status, ping } }`; `503` si Mongo no responde.

## 5. Criterios de aceptación

- [ ] `pnpm dev` levanta la API en `:3001`.
- [ ] `curl localhost:3001/health` → `200` con Mongo `up`.
- [ ] `curl localhost:3001/docs` muestra el Swagger.
- [ ] Apagar Mongo → `/health` devuelve `503`.
- [ ] Env inválido → la app no arranca con log claro.
- [ ] `pnpm lint && pnpm typecheck && pnpm build` en verde.

## 6. Commit y push

```bash
git checkout -b fase/02-backend-base
git add -A
git commit -m "feat(api): bootstrap NestJS with config, swagger and health"
git push -u origin fase/02-backend-base
```

Abrir PR hacia `main`.

## 7. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: adaptador HTTP elegido, desviaciones>`