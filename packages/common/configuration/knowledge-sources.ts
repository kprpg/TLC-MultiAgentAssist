import { z } from 'zod'

export const seismicGraphScopes = ['https://graph.microsoft.com/ExternalItem.Read.All'] as const
export const seismicGraphDefaultScope = 'https://graph.microsoft.com/.default'

const propertyName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/)
export const seismicGraphConfigurationSchema = z.object({
  connectionId: z.string().regex(/^[A-Za-z0-9]{3,32}$/),
  titleProperty: propertyName.default('title'),
  urlProperty: propertyName.default('url'),
  fileTypeProperty: propertyName.optional(),
  modifiedProperty: propertyName.optional()
}).strict()

export type SeismicGraphConfiguration = z.infer<typeof seismicGraphConfigurationSchema>

export function seismicGraphConfigurationFromEnvironment(environment: Readonly<Record<string, string | undefined>>): SeismicGraphConfiguration | undefined {
  const connectionId = environment['TLC_SEISMIC_GRAPH_CONNECTION_ID']?.trim()
  if (!connectionId) return undefined
  const optional = (key: string) => environment[key]?.trim() || undefined
  const titleProperty = optional('TLC_SEISMIC_GRAPH_TITLE_PROPERTY')
  const urlProperty = optional('TLC_SEISMIC_GRAPH_URL_PROPERTY')
  const fileTypeProperty = optional('TLC_SEISMIC_GRAPH_FILE_TYPE_PROPERTY')
  const modifiedProperty = optional('TLC_SEISMIC_GRAPH_MODIFIED_PROPERTY')
  return seismicGraphConfigurationSchema.parse({
    connectionId,
    ...(titleProperty ? { titleProperty } : {}),
    ...(urlProperty ? { urlProperty } : {}),
    ...(fileTypeProperty ? { fileTypeProperty } : {}),
    ...(modifiedProperty ? { modifiedProperty } : {})
  })
}
