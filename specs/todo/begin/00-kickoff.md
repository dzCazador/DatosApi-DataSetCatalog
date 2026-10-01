# Fase 00 — Kickoff

> **Objetivo:** decidir los parámetros abiertos del proyecto y dejar el repositorio Git
> inicializado contra el remoto, con la primera documentación commiteada.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **Remote.** Default: `https://github.com/dzCazador/DatosApi-DataSetCatalog.git`.
2. **Rama por defecto.** Default: `main`.
3. **Visibilidad.** Ya definida por el remoto (no crear otro).
4. **¿Autenticación Git disponible?** Default: sí, vía credential helper o token ya
   configurado.

### Permisos a solicitar

- [ ] `git init` + `git remote add origin <url>`
- [ ] `git add`, `git commit`, `git push`

### Valores por defecto si no hay respuesta

- Remote y rama por defecto indicados arriba. Si el push falla por credenciales, **dejar el
  commit local** y documentar el bloqueo (no reintentar con force ni embebiendo tokens).

---

## 1. Inicializar el repositorio

- [x] `git init` en la raíz y fijar la rama: `git branch -M main`.
- [x] `git remote add origin https://github.com/dzCazador/DatosApi-DataSetCatalog.git`.
- [x] Verificar: `git remote -v`.

## 2. `.gitignore`

- [ ] Crear `.gitignore` con:

```gitignore
node_modules/
dist/
coverage/
.turbo/
*.log

# Entorno
.env
.env.local
!.env.example

# Descargas en runtime (PDF/CSV ingestados)
storage/
tmp/
*.pdf
!specs/**/*.pdf
```

- [x] Verificar que `storage/` y `.env` quedan ignorados: `git check-ignore -v .env storage/x.pdf`.

## 3. Primer commit (documentación)

- [x] `git add -A` y revisar con `git status` que **no** entra nada que no deba.
- [x] Commit:

```bash
git commit -m "docs: add DatosApi specs and roadmap"
git push -u origin main
```

## 4. Criterios de aceptación

- [x] `git remote -v` apunta al remoto correcto.
- [x] `git log --oneline` muestra el commit de docs.
- [x] El push fue exitoso, **o** el bloqueo quedó documentado en §5.

## 5. Estado y decisiones

- Fecha de ejecución: **2026-10-01**
- Remoto: `https://github.com/dzCazador/DatosApi-DataSetCatalog.git`, rama por defecto `main`.
- `.env` y `storage/*.pdf` confirmados como ignorados.
- Cierre con un segundo commit de docs que incorpora el spec de frontend
  ([`specs/frontend.md`](../../frontend.md)), la fase 09 y las actualizaciones de
  `README.md`, `AGENTS.md` y specs.
- Push a `origin/main` con las credenciales ya configuradas en el entorno.