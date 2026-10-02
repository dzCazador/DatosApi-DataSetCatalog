import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';

import { apiRootUrl } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Docs' };

/**
 * Swagger vive en la API (`GET /docs`), no en el panel. Se muestra el enlace explícito en
 * vez de embeber un iframe: el panel es un cliente de la API, no su sitio de documentación
 * (`frontend.md` §1).
 */
export default function DocsPage() {
  const docsUrl = `${apiRootUrl()}/docs`;
  const jsonUrl = `${apiRootUrl()}/docs-json`;

  return (
    <>
      <PageHeader
        title="Documentación de la API"
        description="OpenAPI interactivo y contrato completo, servidos por la API en /docs."
        actions={
          <ButtonLink href={docsUrl} variant="primary">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Abrir Swagger
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Swagger UI</CardTitle>
            <CardDescription>
              Se abre en la API, en otra pestaña. Cada `EndpointDefinition` documenta su ejemplo de{' '}
              <code>GET /e/&#123;slug&#125;</code> con la respuesta real.
            </CardDescription>
          </div>
          <Badge variant="neutral">{docsUrl}</Badge>
        </CardHeader>
        <CardBody className="space-y-3 text-sm text-content-muted">
          <p>
            El panel no duplica el contrato: <code>api-contract.md</code> es la fuente de verdad y Swagger es su
            lectura ejecutable.
          </p>
          <p>
            Para el detalle en JSON:{' '}
            <a href={jsonUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-xs text-brand hover:underline">
              {jsonUrl}
            </a>
          </p>
          <p className="text-xs text-content-subtle">
            Si el enlace no responde, la API no está levantada o <code>NEXT_PUBLIC_API_URL</code> apunta al lugar
            equivocado.
          </p>
        </CardBody>
      </Card>
    </>
  );
}