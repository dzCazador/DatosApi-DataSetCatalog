import type { NextConfig } from 'next';

/**
 * El panel es un cliente de la API: todo lo que necesita viene de `NEXT_PUBLIC_API_URL`.
 * No hay imágenes remotas, ni i18n, ni rewrites: el servidor de Next habla con la API
 * directamente (Server Components y Server Actions), así que CORS sólo afecta al
 * playground cuando se consulta desde el navegador.
 *
 * El puerto sale de `WEB_PORT` y **no** de `-p` en los scripts: pnpm no expande
 * `${VAR:-default}` (no usa shell), así que la variable se resuelve acá, con el default.
 */
function portFromEnv(): number {
  const raw = process.env['WEB_PORT'];
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 3000;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  port: portFromEnv(),
};

export default nextConfig;