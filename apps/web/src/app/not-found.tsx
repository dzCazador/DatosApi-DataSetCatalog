import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle">404</p>
        <h1 className="mt-2 text-xl font-semibold text-content">Esa página no existe en el panel</h1>
        <p className="mt-2 max-w-md text-sm text-content-muted">
          Puede que el recurso se haya borrado, o que la ruta esté mal escrita. Los datasets, fuentes y endpoints no se
          borran en cascada, así que un recurso faltante suele ser un enlace viejo.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3 text-sm">
          <Link href="/" className="font-medium text-brand hover:underline">
            Dashboard
          </Link>
          <span className="text-content-subtle">·</span>
          <Link href="/sources" className="font-medium text-brand hover:underline">
            Fuentes
          </Link>
          <span className="text-content-subtle">·</span>
          <Link href="/endpoints" className="font-medium text-brand hover:underline">
            Endpoints
          </Link>
        </div>
      </div>
    </div>
  );
}