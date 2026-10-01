# Convenciones — DatosApi

> Documento **NORMATIVO**. Reglas de código transversales. Si el código las contradice, el
> spec manda.

---

## 1. TypeScript

### 1.1 Configuración

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": false
  }
}
```

- **Prohibido `any` explícito.** ESLint: `@typescript-eslint/no-explicit-any: error`.
  Usar `unknown` en fronteras y `never[]` como genérico vacío.
- **`strictNullChecks` no se relaja.** Un campo opcional se modela `field?: T`, no `T | null`
  si nunca es `null`.
- Sin `enum` numérico: los enums de dominio son **string** (serializables en JSON sin magic
  numbers).

### 1.2 Nombrado

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivo | `kebab-case` | `pdf-table-extractor.ts` |
| Clase / tipo | `PascalCase` | `PdfTableExtractor` |
| Función / variable | `camelCase` | `extractTables()` |
| Constante | `SCREAMING_SNAKE` | `INGEST_MAX_BYTES` |
| Clave de columna (dato) | `snake_case` | `importe_desde` |
| Colección MongoDB | `snake_case` plural | `endpoint_definitions` |
| Campo de documento | `camelCase` | `defaultLimit` |
| Handler NestJS | `xxxHandler` | `ingestHandler` |

> **La contradicción es intencional y es la regla más importante del proyecto:** los
> *atributos internos* son `camelCase`; las *claves de datos* (`schema[].key`, filas) son
> `snake_case` porque son la **superficie pública** del endpoint y no deben cambiar si se
> renombra un campo interno. Ver [`data-model.md`](data-model.md) §1.

### 1.3 Imports

- Alias obligatorios: `@datosapi/common`, `@datosapi/database`. Nunca rutas relativas entre
  paquetes (`../../common/src/...`).
- Dentro de un paquete: imports relativos.
- Orden: externos → `@datosapi/*` → relativos.
- Sin barrels con efectos secundarios: `packages/common/src/index.ts` sólo reexporta tipos y
  valores puros.

---

## 2. Estructura de archivos por módulo NestJS

```text
src/<módulo>/
├── <módulo>.module.ts
├── <módulo>.controller.ts
├── <módulo>.service.ts
├── <módulo>.service.spec.ts
├── dto/
│   ├── create-<entidad>.dto.ts
│   ├── update-<entidad>.dto.ts
│   └── query-<entidad>.dto.ts
├── entities/
│   └── <entidad>.entity.ts      # tipo de dominio + mapper del documento Mongoose
└── repositories/
    └── <entidad>.repository.ts  # interface + implementation
```

- **Controller:** sólo valida, delega y serializa. Cero lógica de negocio, cero acceso a
  Mongoose.
- **Service:** casos de uso y orquestación. Es el único que conoce a los repositorios.
- **Repository:** encapsula queries de Mongoose. Los services **no** escriben queries.
- **Entity:** tipo de dominio independiente del documento de Mongoose. El mapper hace la
  traducción; los `_id` se convierten a `string` en la frontera HTTP.

---

## 3. DTOs y validación

- Todos los DTOs son **clases** con `class-validator`.
- El `ValidationPipe` global se configura así:

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,   // campo desconocido -> 400, no se ignora
  transform: true,
  transformOptions: { enableImplicitConversion: true },
})
```

- `forbidNonWhitelisted: true` es **obligatorio**: una API donde los campos desconocidos se
  ignoran en silencio esconde bugs del cliente.
- `@ApiProperty()` en cada campo (Swagger), con `example` cuando sea relevante.
- Los DTOs de respuesta se mapean explícitamente; nunca se devuelve el documento crudo de
  Mongoose (filtraría `__v`, ids internos y campos futuros).

---

## 4. Errores

### 4.1 Excepciones de Nest

Usar las de fábrica, nunca `throw new Error()`:

| Situación | Excepción |
|---|---|
| Input inválido | `BadRequestException` |
| Recurso inexistente | `NotFoundException` |
| Conflicto de unicidad / estado | `ConflictException` |
| Content-type no soportado | `UnsupportedMediaTypeException` |
| Body excede el límite | `PayloadTooLargeException` |
| Contenido no interpretable | `UnprocessableEntityException` |
| Origen caído | `BadGatewayException` |
| Origen lento | `GatewayTimeoutException` |

### 4.2 Filtro global

Un `HttpExceptionFilter` único que responde con la forma de
[`api-contract.md`](api-contract.md) §1.1, con `code` derivado de una clase propia
(`DomainException extends HttpException`) y fallback `INTERNAL_ERROR`.

### 4.3 Regla

**Un error de datos (`422`) y un error de origen (`502`/`504`) nunca se confunden.** Son
diagnósticos distintos para quien opera el sistema. La tabla de
[`ingestion.md`](ingestion.md) §7 es de cumplimiento obligatorio.

---

## 5. mongoose

- Un único `MongooseModule.forRoot` (en `packages/database`). Prohibido `mongoose.connect()`
  suelto o dependencias con su propio cliente.
- **No** declarar `strictQuery: false`: el filtro por queryParams se valida contra el
  allowlist del endpoint **antes** de tocar la capa de persistencia.
- Toda consulta que nace de un valor del usuario se construye con el objeto de filtro de
  Mongoose (`{ field: { $gte: value } }`), **nunca** con `JSON.parse` de un string ni con
  `$where`.
- Proyecciones y orden se arman con listas blancas, no con lo que llega del cliente.
- `toJSON` / `toObject` virtuals: `false`. El mapeo a respuesta es explícito en el service.
- Indices declarados en el `@Schema` (ver [`data-model.md`](data-model.md)), no con
  `createIndex()` manuales.

---

## 6. Valores y formatos

| Tipo | Regla |
|---|---|
| Fechas | `Date` en UTC internamente; date-only (`YYYY-MM-DD`) en la API y en columnas de vigencia. |
| Importes / porcentajes | `number`, nunca `string`. La normalización es en la ingesta. |
| Montos con decimales | `decimalScale` explícito en `ColumnSchema` cuando el origen los define. |
| Vacíos | `null`, nunca `''`. Un `"0"` es `0`, no `null`. |
| Porcentajes | Se normalizan a fracción (`35%` → `0.35`) y `decimalScale: 4`. |
| Slugs | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–80 chars, minúscula y sin acentos. |
| Nombres de columna | snake_case, único dentro del dataset, desambiguado con sufijo. |

### 6.1 Normalización de números (es-AR)

| Entrada | Salida |
|---|---|
| `"1.234,56"` | `1234.56` |
| `"35%"` | `0.35` |
| `"$ 1.000"` | `1000` |
| `"1.234"` | `string` + `warning: ambiguous-number` |
| `"12.5"` | `12.5` |

Detalle y algoritmo en [`ingestion.md`](ingestion.md) §6.

---

## 7. Comments y código

- **Cero comentarios obvios.** Nada de `// incrementa i` ni `// devuelve el resultado`.
- Comentario sólo cuando aporta algo que el código no dice: **por qué** se eligió un umbral,
  **por qué** un caso es raro, **qué** pasa si se cambia algo.
- Las constantes mágicas que dependen de una decisión van como `const` con nombre
  (`LINE_Y_TOLERANCE = 0.5`).
- Funciones cortas y con un propósito. Si necesita un párrafo para explicarse, hay que
  partirla.
- Prohibido commented-out code.

---

## 8. Testing

| Tipo | Ubicación | Alcance |
|---|---|---|
| Unitario | `src/**/*.spec.ts` junto al código | Una unidad, sin I/O real. |
| e2e | `test/*.e2e-spec.ts` | App completa con Mongo real (o `mongodb-memory-server`). |
| Fixture | `src/**/__fixtures__/` | PDF de muestra en miniatura, CSV, JSON. **Nunca** binarios grandes. |

- **Prohibidos mocks en código productivo.** Los dobles viven sólo en tests.
- Los doubles de test se crean a mano o con `jest.fn()`; no se agrega `jest-mock-extended`
  al MVP.
- Un test de normalización **debe** tener su caso ambiguo esperado (`"1.234"` → string +
  warning). Un test que sólo prueba el camino feliz no prueba el normalizador.
- El test de la ingesta PDF usa un **PDF fixture propio**, no el de AFIP (evita depender de
  red en CI). El PDF real se prueba en el smoke test manual de la fase 08.

---

## 9. Git y commits

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`, `refactor:`,
  `perf:`).
- **Los mensajes de commit van en inglés**, en una línea, imperativo y concisos
  (≤ 72 caracteres). Con scope cuando aporta: `feat(api): add pdf table extractor`.
- Cierre de fase: `feat: phase NN — <short summary>`.
- Un commit por fase, en la rama `fase/NN-<slug>`, contra el remoto
  `https://github.com/dzCazador/DatosApi-DataSetCatalog.git`.
- Nunca se commitean: `.env`, `storage/`, PDFs descargados, `coverage/`, `node_modules/`.
- El `.gitignore` incluye `storage/`, `.env`, `*.local`, `coverage/`, `.turbo/`, `dist/`.

---

## 10. Logging

- `Logger` de Nest con contexto explícito: `new Logger(IngestService.name)`.
- Niveles: `debug` (detalle de parsing), `log` (eventos de negocio: ingesta creada,
  dataset publicado, endpoint creado), `warn` (warnings de extracción, no-fatal),
  `error` (fallos con stack).
- **Nunca** loguear el payload completo de un dataset (puede contener datos sensibles) ni
  headers de petición con credenciales. Loguear `contentType`, `bytes`, `rowCount`.
- Todo warning de extracción se refleja **en el documento** (`warnings[]`) además del log:
  el log se pierde, el documento no.