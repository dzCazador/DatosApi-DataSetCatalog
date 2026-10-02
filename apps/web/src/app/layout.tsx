import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Navbar } from '@/components/layout/navbar';
import { THEME_SCRIPT, Sidebar } from '@/components/layout/shell';
import { ToastProvider } from '@/components/ui/toast';
import { apiHealth } from '@/lib/api';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'DatosApi · Panel',
    template: '%s · DatosApi',
  },
  description: 'Panel de administración de DatosApi: fuentes, datasets y endpoints dinámicos.',
};

/**
 * Shell con sidebar fijo, navbar superior y contenido en tarjetas. La API se consulta una
 * vez acá y el resultado se pasa a la navbar: el indicador no hace fetch propio.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const health = await apiHealth();

  return (
    <html lang="es-AR" suppressHydrationWarning>
      <head>
        {/* Antes del primer pintado, para que no haya destello del tema equivocado. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-surface text-content">
        <ToastProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Navbar health={health} />
              <main className="flex-1 px-6 py-6">
                <div className="mx-auto w-full max-w-7xl">{children}</div>
              </main>
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}