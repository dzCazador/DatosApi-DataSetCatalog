'use client';

import { ShieldCheck } from 'lucide-react';

import { ActionForm, SubmitButton } from '@/components/ui/action-form';
import { validateEndpointAction } from '@/lib/actions/endpoints';

/**
 * `POST /endpoints/:id/validate` es un reporte y siempre devuelve 200: `valid` y la lista
 * de `unknownFields` con el `where` de cada una llegan en el mensaje de la acción. Es la
 * vía para detectar que una reingesta le quitó una columna a la definición.
 */
export function ValidateEndpointButton({ endpointId }: { endpointId: string }) {
  return (
    <ActionForm action={async () => validateEndpointAction(endpointId)}>
      <SubmitButton variant="secondary" pendingLabel="Validando…">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        Validar contra el schema
      </SubmitButton>
    </ActionForm>
  );
}