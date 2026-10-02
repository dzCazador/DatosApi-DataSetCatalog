'use client';

import { RefreshCw } from 'lucide-react';

import { ActionForm, SubmitButton } from '@/components/ui/action-form';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ingestSourceAction } from '@/lib/actions/sources';

/**
 * Dispara `POST /sources/:id/ingest`. El resultado viaja en el mensaje de la acción, que
 * ya trae `rowCount`, `warnings` y `durationMs`: la ingesta es un paso explícito y su
 * outcome es parte de la pantalla, no un toast que se pierde.
 */
export function IngestPanel({ sourceId, status }: { sourceId: string; status: string }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Ingesta</CardTitle>
          <CardDescription>
            Cada ingesta crea una <strong>versión nueva</strong> del dataset. Nunca pisa una publicada.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {status === 'processing' ? (
          <Alert tone="info" title="Hay una ingesta en curso." detail="Un segundo disparo sería un 409 INGEST_ALREADY_RUNNING." />
        ) : null}

        <ActionForm action={async () => ingestSourceAction(sourceId)} successMessage="Ingesta disparada.">
          <SubmitButton pendingLabel="Ingestando…">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Ingerir ahora
          </SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  );
}