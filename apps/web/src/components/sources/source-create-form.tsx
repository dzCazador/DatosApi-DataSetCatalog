'use client';

import { useState } from 'react';

import { ActionForm, SubmitButton } from '@/components/ui/action-form';
import { ButtonLink } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { createSourceAction } from '@/lib/actions/sources';
import { SOURCE_TYPES, SOURCE_TYPE_HINTS, SOURCE_TYPE_LABELS } from '@/lib/schema/source-form';
import type { SourceType } from '@/lib/api/types';

/**
 * Alta de fuente. El formulario cambia según el `type`: sólo pide los campos de la
 * variante del `SourceConfig` correspondiente (`data-model.md` §2.1). A una fuente manual
 * no se le pide `url` porque el backend la rechazaría con `400 SOURCE_CONFIG_INVALID`.
 */
export function SourceCreateForm() {
  const [type, setType] = useState<SourceType>('pdf');
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Nueva fuente</CardTitle>
          <CardDescription>
            Registrar el origen y la ingesta son pasos separados: crearla deja el estado <code>pending</code> y después
            disparás la ingesta desde su detalle.
          </CardDescription>
        </div>
      </CardHeader>

      <CardBody>
        <ActionForm action={createSourceAction} successMessage="Fuente creada.">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <Field label="Nombre" htmlFor="name" required>
                <Input id="name" name="name" maxLength={200} placeholder="Escala Retención Ganancias 4ta Cat" required />
              </Field>

              <Field label="Tipo" htmlFor="type" hint={SOURCE_TYPE_HINTS[type]} required>
                <Select
                  id="type"
                  name="type"
                  value={type}
                  onChange={(event) => setType(event.target.value as SourceType)}
                >
                  {SOURCE_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {SOURCE_TYPE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Descripción" htmlFor="description">
                <Input id="description" name="description" maxLength={1000} placeholder="Opcional" />
              </Field>

              <Field
                label="Headers de la petición"
                htmlFor="requestHeaders"
                hint="Uno por línea, como `Authorization: Bearer …`. Se mandan tal cual."
              >
                <Textarea id="requestHeaders" name="requestHeaders" rows={3} />
              </Field>
            </div>

            <div className="space-y-5 rounded-card border border-line bg-surface-sunken/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle">
                Configuración de «{SOURCE_TYPE_LABELS[type]}»
              </p>

              {type === 'manual' ? (
                <div className="space-y-5">
                  <Field label="Formato del payload" htmlFor="format" required>
                    <Select
                      id="format"
                      name="format"
                      value={format}
                      onChange={(event) => setFormat(event.target.value as 'json' | 'csv')}
                    >
                      <option value="json">JSON (array u objeto)</option>
                      <option value="csv">CSV (texto con el contenido)</option>
                    </Select>
                  </Field>

                  <Field label="Payload" htmlFor="payload" required>
                    <Textarea
                      id="payload"
                      name="payload"
                      rows={10}
                      placeholder={
                        format === 'json' ? '[{"tramo":"1","importe_desde":0}]' : 'tramo,importe_desde\n1,0\n2,54785.28'
                      }
                      required
                    />
                  </Field>

                  {format === 'csv' ? (
                    <>
                      <Field label="Delimitador" htmlFor="delimiter" hint="Por defecto `,`.">
                        <Input id="delimiter" name="delimiter" maxLength={1} placeholder="," />
                      </Field>
                      <label className="flex items-center gap-2 text-sm text-content">
                        <Checkbox name="hasHeaderRow" value="true" defaultChecked />
                        La primera fila es el encabezado
                      </label>
                    </>
                  ) : null}
                </div>
              ) : null}

              {type === 'api' ? (
                <div className="space-y-5">
                  <Field label="URL" htmlFor="url" required>
                    <Input id="url" name="url" type="url" placeholder="https://api.origen.com/datos" required />
                  </Field>
                  <Field label="Método" htmlFor="method" required>
                    <Select
                      id="method"
                      name="method"
                      value={method}
                      onChange={(event) => setMethod(event.target.value as 'GET' | 'POST')}
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </Select>
                  </Field>
                  <Field
                    label="Cuerpo"
                    htmlFor="body"
                    required={method === 'POST'}
                    hint="JSON o texto plano. Sólo para POST."
                  >
                    <Textarea id="body" name="body" rows={5} />
                  </Field>
                  <Field label="jsonPath" htmlFor="jsonPath" hint="Ruta al nodo con los datos, ej. `data.resultados`.">
                    <Input id="jsonPath" name="jsonPath" placeholder="Vacío = la raíz" />
                  </Field>
                </div>
              ) : null}

              {type === 'url' ? (
                <div className="space-y-5">
                  <Field label="URL" htmlFor="url" required hint="CSV, JSON o TXT descargable.">
                    <Input id="url" name="url" type="url" placeholder="https://origen.com/tabla.csv" required />
                  </Field>
                  <Field
                    label="contentTypeHint"
                    htmlFor="contentTypeHint"
                    hint="Sólo si el servidor no manda el content-type correcto."
                  >
                    <Input id="contentTypeHint" name="contentTypeHint" placeholder="text/csv" />
                  </Field>
                </div>
              ) : null}

              {type === 'pdf' ? (
                <div className="space-y-5">
                  <Field label="URL del PDF" htmlFor="url" required hint="Se descarga en runtime y no se versiona.">
                    <Input id="url" name="url" type="url" placeholder="https://www.afip.gob.ar/…/Tabla-Art-94-LIG.pdf" required />
                  </Field>
                  <Field label="Páginas" htmlFor="pages" hint="CSV 0-indexado. Vacío = todas.">
                    <Input id="pages" name="pages" placeholder="0,1" />
                  </Field>
                  <Field label="Índice de tabla" htmlFor="tableIndex" hint="Vacío = la primera tabla útil.">
                    <Input id="tableIndex" name="tableIndex" inputMode="numeric" placeholder="0" />
                  </Field>
                  <Field label="Pistas del encabezado" htmlFor="headerHints" hint="Una por línea. Ayudan a ubicar la tabla.">
                    <Textarea id="headerHints" name="headerHints" rows={4} placeholder={'Tramo\nImporte\nAlícuota'} />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2">
            <SubmitButton>Crear fuente</SubmitButton>
            <ButtonLink href="/sources" variant="ghost">
              Cancelar
            </ButtonLink>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}