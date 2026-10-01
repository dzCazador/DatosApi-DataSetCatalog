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

- [ ] `package.json` raíz:

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

- [ ] `pnpm-workspace.yaml`: `apps/*`, `packages/*`.
- [ ] `turbo.json` con tasks `dev`, `build`, `lint`, `test`, `typecheck`.
- [ ] `tsconfig.base.json` raíz con `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `declaration`, `esModuleInterop`, `moduleResolution: node`.
- [ ] `.nvmrc` con `22`, `.editorconfig`, `.prettierrc`.
- [ ] `pnpm install` desde la raíz.

> En esta fase **no** se crea `apps/api` (fase 02).

## 2. Variables de entorno

- [ ] `.env.example` en la raíz con **todas** las claves de
  [`stack.md`](../../stack.md) §6 (App, Database, Ingesta, Endpoint dinámico).
- [ ] Copiar a `.env` (ignorado) y completar `MONGODB_URI`.
- [ ] Regla: los secretos se validan con Joi al arrancar (fase 02) y nunca se commitean.

## 3. `docker-compose.yml`

- [ ] Servicio `mongo` con `mongo:7`, auth activada, volumen, healthcheck y red propia.

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

- [ ] Validar con `docker compose config`.

## 4. Levantar y verificar

- [ ] `docker compose up -d` y `docker compose ps` (todo `healthy`).
- [ ] Conectar:
  `docker exec -it datosapi-mongo mongosh -u datosapi -p change_me --authenticationDatabase admin datosapi --eval "db.runCommand({ping:1})"`.
- [ ] Persistencia: `docker compose down` + `up -d` y los datos sobreviven.

## 5. Criterios de aceptación

- [ ] `pnpm install` corre sin errores.
- [ ] `docker compose up -d` levanta MongoDB y pasa el healthcheck.
- [ ] `.env.example` documenta **todas** las variables; `.env` y `storage/` ignorados.

## 6. Commit y push

```bash
git checkout -b fase/01-bootstrap-monorepo
git add -A
git commit -m "chore: bootstrap pnpm and turbo monorepo with mongo"
git push -u origin fase/01-bootstrap-monorepo
```

Abrir PR hacia `main`.

## 7. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: versiones instaladas, puertos, desvíos>`