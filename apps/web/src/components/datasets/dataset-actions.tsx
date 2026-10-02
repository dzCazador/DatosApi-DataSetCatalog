'use client';

import { CheckCircle2, Archive } from 'lucide-react';

import { ActionForm, SubmitButton } from '@/components/ui/action-form';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { archiveDatasetAction, publishDatasetAction } from '@/lib/actions/datasets';
import type { DatasetStatus } from '@/lib/api/types';

/**
 * Publicar es `draft → published` y archivar es `published → archived`: las dos son
 * transiciones deliberadas y las dos piden confirmación. Un `409 DATASET_INVALID_STATE`
 * se explica en el toast con el estado real del dataset.
 */
export function DatasetActions({ datasetId, status }: { datasetId: string; status: DatasetStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'draft' ? (
        <ActionForm action={async () => publishDatasetAction(datasetId)} successMessage="Dataset publicado.">
          <SubmitButton pendingLabel="Publicando…">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Publicar
          </SubmitButton>
        </ActionForm>
      ) : null}

      {status === 'published' ? (
        <ConfirmButton
          action={async () => archiveDatasetAction(datasetId)}
          confirmTitle="Archivar el dataset"
          confirmBody={
            <p>
              Los endpoints que lo apuntan van a devolver <code>422 SCHEMA_MISMATCH</code> al consultarse, salvo que
              usen <code>followLatest</code>. El dataset no se borra: queda <code>archived</code>.
            </p>
          }
          confirmLabel="Archivar"
          variant="secondary"
          pendingLabel="Archivando…"
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
          Archivar
        </ConfirmButton>
      ) : null}

      {status === 'archived' ? (
        <p className="text-xs text-content-subtle">
          Un dataset archivado es histórico: no se vuelve a publicar. Reingerí para crear una versión nueva.
        </p>
      ) : null}
    </div>
  );
}