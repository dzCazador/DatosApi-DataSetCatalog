'use client';

import { Trash2 } from 'lucide-react';

import { ConfirmButton } from '@/components/ui/confirm-button';
import { deleteSourceAction } from '@/lib/actions/sources';

/**
 * El borrado de una fuente tiene efectos: deshabilita los endpoints asociados y deja el
 * source en `error` con `lastError` explicando la dependencia (`data-model.md` §5). La
 * confirmación lo dice, porque no es un borrado inocuo.
 */
export function DeleteSourceButton({ sourceId, endpointCount }: { sourceId: string; endpointCount: number }) {
  const affected =
    endpointCount === 0
      ? 'No hay endpoints asociados a esta fuente.'
      : `Va a deshabilitar ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'} asociado${endpointCount === 1 ? '' : 's'}.`;

  return (
    <ConfirmButton
      action={async () => deleteSourceAction(sourceId)}
      confirmTitle="Borrar la fuente"
      confirmBody={
        <>
          <p>
            Esto <strong>no borra los datasets</strong>: sus versiones quedan intactas. La fuente pasa a{' '}
            <code>status = error</code> y queda registrada la dependencia.
          </p>
          <p className="mt-2">{affected}</p>
          <p className="mt-2 font-medium">Si sólo querés dejar de ingerir, conviene desactivar sus endpoints.</p>
        </>
      }
      confirmLabel="Borrar fuente"
      variant="danger"
      size="sm"
      pendingLabel="Borrando…"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      Borrar
    </ConfirmButton>
  );
}