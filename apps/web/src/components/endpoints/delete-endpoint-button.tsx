'use client';

import { Trash2 } from 'lucide-react';

import { ConfirmButton } from '@/components/ui/confirm-button';
import { deleteEndpointAction } from '@/lib/actions/endpoints';

/**
 * Hard-delete de la definición. Los datasets quedan intactos: lo que se borra es la
 * publicación, y con ella la URL `/e/:slug`.
 */
export function DeleteEndpointButton({ endpointId, slug }: { endpointId: string; slug: string }) {
  return (
    <ConfirmButton
      action={async () => deleteEndpointAction(endpointId)}
      confirmTitle="Borrar la definición"
      confirmBody={
        <>
          <p>
            Se borra la definición y deja de existir <code>/e/{slug}</code>, que pasa a responder{' '}
            <code>404 SLUG_NOT_FOUND</code>.
          </p>
          <p className="mt-2">Los datasets y sus versiones no se tocan.</p>
        </>
      }
      confirmLabel="Borrar definición"
      variant="danger"
      size="sm"
      pendingLabel="Borrando…"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      Borrar
    </ConfirmButton>
  );
}