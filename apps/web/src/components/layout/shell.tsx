'use client';

import { BookOpen, Database, LayoutDashboard, Link2, Moon, Network, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

const THEME_KEY = 'datosapi-theme';
type Theme = 'light' | 'dark';

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/** Tema claro por defecto, persistido en `localStorage` (`frontend.md` §6.6). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    setReady(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Sin storage disponible: el tema dura lo que dura la pestaña, que es aceptable.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={ready && theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}
      aria-pressed={ready ? theme === 'dark' : undefined}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-content-muted transition-colors hover:bg-surface-sunken hover:text-content"
    >
      {ready && theme === 'dark' ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Prefijo exacto: `/endpoints` no matchea `/endpoints/x` sólo; ambos lo matchean. */
  exact?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/sources', label: 'Fuentes', icon: Database },
  { href: '/datasets', label: 'Datasets', icon: Network },
  { href: '/endpoints', label: 'Endpoints', icon: Link2 },
  { href: '/docs', label: 'Docs', icon: BookOpen },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact === true) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Sidebar fijo y colapsable. Es cliente sólo porque necesita dos cosas que el servidor no
 * tiene: la ruta activa y el estado de colapso.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('datosapi-sidebar') === 'collapsed');
    } catch {
      // Sin storage: se queda expandido, que es el estado por defecto.
    }
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('datosapi-sidebar', next ? 'collapsed' : 'expanded');
    } catch {
      // Ver arriba.
    }
  };

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-surface-raised transition-[width]',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-line px-4', collapsed && 'justify-center px-0')}>
        <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-fg">
            D
          </span>
          {!collapsed ? (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-content">DatosApi</span>
              <span className="block truncate text-xs text-content-subtle">Panel de administración</span>
            </span>
          ) : null}
        </Link>
      </div>

      <nav aria-label="Secciones" className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-brand-soft text-brand'
                  : 'text-content-muted hover:bg-surface-sunken hover:text-content',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expandir el menú' : 'Colapsar el menú'}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-content-muted transition-colors hover:bg-surface-sunken hover:text-content',
            collapsed && 'justify-center px-0',
          )}
        >
          <MenuIcon collapsed={collapsed} />
          {!collapsed ? <span>Colapsar</span> : null}
        </button>
      </div>
    </aside>
  );
}

function MenuIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      {collapsed ? (
        <path d="M7 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}