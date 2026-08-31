import { sql, type SQL } from 'drizzle-orm'

export function canonicalApprovedTriageSql(triage: SQL): SQL {
  return sql`
    ${triage} is not null
    and jsonb_typeof(${triage}) = 'object'
    and ${triage} ?& array['ownerRef', 'ownerName', 'escalatedAt']
    and ${triage} - 'ownerRef' - 'ownerName' - 'escalatedAt' = '{}'::jsonb
    and jsonb_typeof(${triage}->'ownerRef') = 'string'
    and char_length(btrim(${triage}->>'ownerRef')) between 1 and 200
    and (${triage}->'ownerName' = 'null'::jsonb or (jsonb_typeof(${triage}->'ownerName') = 'string' and char_length(${triage}->>'ownerName') <= 200))
    and jsonb_typeof(${triage}->'escalatedAt') = 'string'
    and ${triage}->>'escalatedAt' ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?Z$'
  `
}
