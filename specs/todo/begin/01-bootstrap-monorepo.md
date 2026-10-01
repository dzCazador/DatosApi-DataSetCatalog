# Fase 01 — Bootstrap del monorepo e infraestructura Docker

> **Objetivo:** dejar el monorepo pnpm + Turborepo y la infraestructura local (MongoDB)
> operativa y reproducible.

**Spec de referencia:** [`stack.md`](../../stack.md) §3, §4, §6.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **Credenciales de MongoDB locales.** Default: `MONGO_ROOT_USER=datosapi`,
   `MONGO_ROOT_PASSWORD=change_me`, `MONGO_DB=datosapi`.
2. **Puerto de MongoDB** (por si está ocupado). Default: `27017`.
3. **Puerto de la API.** Default: `3001` (para no chocar con otras apps de Nest).
4. **Nombre del paquete raíz.** Default: `datosapi`.

### Permisos a solicitar

- [ ] `pnpm install` (creará `pnpm-lock.yaml`).
- [ ] Levantar/bajar contenedores Docker (`docker compose up/down`).
- [ ] Publicar el puerto `27017` en localhost.

### Valores por defecto si no hay respuesta

- Aplicar los defaults y **documentarlos** en `.env.example`.

---

## 1. Configurar el monorepo

- [x] `package.json` raíz:

```jsonc
{
  "name": "datosapi",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down",
    "infra:logs": "docker compose logs -f"
  },
  "devDependencies": { "turbo": "^2.0.0" }
}
```

- [x] `pnpm-workspace.yaml`: `apps/*`, `packages/*`.
- [x] `turbo.json` con tasks `dev`, `build`, `lint`, `test`, `typecheck`.
- [x] `tsconfig.base.json` raíz con `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `declaration`, `esModuleInterop`, `moduleResolution: node`.
- [x] `.nvmrc` con `22`, `.editorconfig`, `.prettierrc`.
- [x] `pnpm install` desde la raíz.

> En esta fase **no** se crea `apps/api` (fase 02).

## 2. Variables de entorno

- [x] `.env.example` en la raíz con **todas** las claves de
  [`stack.md`](../../stack.md) §6 (App, Database, Ingesta, Endpoint dinámico).
- [x] Copiar a `.env` (ignorado) y completar `MONGODB_URI`.
- [x] Regla: los secretos se validan con Joi al arrancar (fase 02) y nunca se commitean.

## 3. `docker-compose.yml`

- [x] Servicio `mongo` con `mongo:7`, auth activada, volumen, healthcheck y red propia.

```yaml
services:
  mongo:
    image: mongo:7
    container_name: datosapi-mongo
    restart: unless-stopped
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_ROOT_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASSWORD}
      MONGO_INITDB_DATABASE: ${MONGO_DB}
    ports: ["27017:27017"]
    volumes: [mongo_data:/data/db]
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [datosapi]

volumes:
  mongo_data:

networks:
  datosapi:
    driver: bridge
```

- [x] Validar con `docker compose config`.

## 4. Levantar y verificar

- [x] `docker compose up -d` y `docker compose ps` (todo `healthy`).
- [x] Conectar:
  `docker exec -it datosapi-mongo mongosh -u datosapi -p change_me --authenticationDatabase admin datosapi --eval "db.runCommand({ping:1})"`.
- [x] Persistencia: `docker compose down` + `up -d` y los datos sobreviven.

## 5. Criterios de aceptación

- [x] `pnpm install` corre sin errores.
- [x] `docker compose up -d` levanta MongoDB y pasa el healthcheck.
- [x] `.env.example` documenta **todas** las variables; `.env` y `storage/` ignorados.

## 6. Commit y push

La fase se desarrolló en `fase/01-bootstrap-monorepo` y luego se mergeó a `main`
(fast-forward). **Decisión del owner (2026-10-01): de ahora en adelante todo se commitea
directo en `main`**, sin ramas por fase ni Pull Requests (ver `AGENTS.md` §4). La rama
`fase/01-bootstrap-monorepo` fue eliminada local y remoto.

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "chore: bootstrap pnpm and turbo monorepo with mongo"
git push origin main
```

## 7. Estado y decisiones

- Fecha de ejecución: **2026-10-01**
- Versiones instaladas: Node v24.14.0 (el repo declara `.nvmrc` 22 y `engines >=22`), pnpm
  9.0.0, turbo 2.11.6, TypeScript 5.9.3, Prettier 3.9.9, Docker Compose v5.1.0, `mongo:7`.
- Puertos: API `3001` (fase 02), MongoDB `27017` publicado; `MONGO_PORT` quedó en
  `.env.example` por si el puerto está ocupado.
- Credenciales locales: `MONGO_ROOT_USER=datosapi`, `MONGO_ROOT_PASSWORD=change_me`,
  `MONGO_DB=datosapi`. Son valores de desarrollo; fuera de dev van como secretos del
  orquestador.
- Verificado: `docker compose config` válido, healthcheck `healthy`, `ping` OK y el volumen
  sobrevive a `down` + `up -d` (se insertó y leyó un documento de prueba; luego se dropeó la
  colección).
- Desvíos respecto del compose del spec:
  - Se agregó `name: datosapi` y defaults `${VAR:-valor}` para que `docker compose config`
    valide sin `.env` presente. El resultado es equivalente al del spec.
  - El healthcheck incluye `--username/--password/--authenticationDatabase`: sin eso `ping`
    falla en una instancia con auth activada.
  - `MONGO_PORT` se agregó a `.env.example` para poder mapear otro puerto del host.
  - `.prettierignore` excluye `*.md`: el wrapping manual de los specs es intencional y
    Prettier lo reformatea en masa. `pnpm format` sólo cubre código y config.
- `pnpm lint`, `pnpm typecheck` y `pnpm build` corren en verde vía turbo pero reportan `0
  tasks`: todavía no hay ningún workspace. `apps/api` llega en la fase 02 y los paquetes en
  la 03.