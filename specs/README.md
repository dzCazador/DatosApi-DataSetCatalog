# Specs de DatosApi — índice normativo

> Punto de entrada a la documentación técnica de **DatosApi**. Los documentos marcados
> **NORMATIVO** son la **fuente única de verdad**; si algo los contradice, mandan ellos. El
> resto son referencias de apoyo.

---

## Qué es este sistema

DatosApi es un **catálogo de datasets versionados con API de consulta propia**. El usuario
registra una **fuente** (API externa, URL, PDF o carga manual), el sistema la **ingiere y
normaliza** en un `Dataset` inmutable, y puede **publicar** ese dataset como un **endpoint
REST dinámico** que se define por datos, no por código.

El stack tecnológico es **similar** al de SueldoNext (monorepo pnpm + Turborepo + NestJS +
TypeScript estricto + ESLint + Jest + Docker), pero **el dominio es distinto**: acá las
entidades centrales son `Source`, `Dataset` y `EndpointDefinition`, y la base de datos es
**NoSQL (MongoDB)** en lugar de PostgreSQL + Prisma.

---

## Documentos

| Documento | Estado | Cuándo leerlo |
|---|---|---|
| [`architecture.md`](architecture.md) | NORMATIVO | Visión general, capas, flujo de ingesta, decisiones macro |
| [`stack.md`](stack.md) | NORMATIVO | Tecnologías, versiones y matriz de decisiones |
| [`data-model.md`](data-model.md) | NORMATIVO | Colecciones MongoDB, índices y evolución |
| [`ingestion.md`](ingestion.md) | NORMATIVO | Estrategias de ingesta, parsing y normalización |
| [`api-contract.md`](api-contract.md) | NORMATIVO | Contrato REST completo (CRUD + endpoint dinámico) |
| [`conventions.md`](conventions.md) | NORMATIVO | Convenciones de código, nombres y errores |
| [`todo/begin/`](todo/begin/) | GUÍA | Puesta en marcha por fases (ejecutables por agentes) |

---

## Cómo se relacionan

```text
architecture.md ── define el QUÉ y el CÓMO macro
   ├── stack.md ───────────── tecnologías y versiones
   ├── data-model.md ──────── colecciones MongoDB e índices
   ├── ingestion.md ─────────Strategies de ingesta (pdf/api/url/manual)
   ├── api-contract.md ────── superficie HTTP pública
   └── conventions.md ─────── reglas de código transversales
```

`todo/begin/` traduce todo lo anterior a pasos ejecutables de puesta en marcha. Cada fase es
autónoma, pregunta y pide permisos al inicio, y cierra con verificación + commit (ver
[`../AGENTS.md`](../AGENTS.md)).

---

## Principios irrenunciables

1. **El dato ingested es inmutable.** Cada ingesta crea un `Dataset` nuevo con
   `version + 1`. Nunca se sobrescribe historia.
2. **El esquema manda.** El `schema` del dataset es la fuente de verdad de tipos y nombres;
   el endpoint dinámico valida contra él, nunca contra el query string.
3. **Nada de consultas construidas por concatenación.** Los filtros se resuelven desde un
   allowlist declarado en el `EndpointDefinition`.
4. **Todo origen es trazable.** Cada dataset conserva la URL de origen, el timestamp de
   descarga y los warnings de extracción.
5. **Agregar un endpoint no requiere deploy.** Es una operación de datos, no de código.
6. **La extracción es honesta.** Si el parser no está seguro, lo dice en `warnings` en vez de
   inventar valores.