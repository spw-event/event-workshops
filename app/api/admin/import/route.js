import { checkAuth, json, resolveEvent } from '@/lib/adminApi'
import { applyPlan, planImport, summarize, validateInput } from '@/lib/adminImport'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/admin/import — token-authenticated bulk load of staff, workshops +
// sessions, and partners for one event. Dry run unless dry_run: false.
// Spec: docs/admin-import-spec.md
export async function POST(request) {
  const unauthorized = checkAuth(request)
  if (unauthorized) return unauthorized

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  const { errors: inputErrors, input } = validateInput(body)
  if (inputErrors.length) return json({ error: 'Validation failed; nothing was written.', errors: inputErrors }, 400)

  try {
    const db = getSupabaseAdmin()
    const { event, error: eventError } = await resolveEvent(db, input.event)
    if (eventError) return json({ error: eventError }, 400)

    const plan = await planImport(db, event, input)
    if (plan.errors.length) return json({ error: 'Validation failed; nothing was written.', errors: plan.errors }, 400)

    const failure = input.dryRun ? null : await applyPlan(db, plan.ops)
    const response = {
      dry_run: input.dryRun,
      event: { id: event.id, name: event.name },
      summary: summarize(plan.results),
      results: plan.results
    }
    if (failure) {
      response.error = `Import stopped partway: ${failure.message}. Results marked applied: true were written; the rest were not.`
      response.failed = failure.failed
    }

    if (!input.dryRun) {
      const { error: logError } = await db.from('import_log').insert({
        event_id: event.id,
        source: input.source,
        dry_run: false,
        summary: failure ? { ...response.summary, error: failure.message } : response.summary,
        results: plan.results
      })
      if (logError) response.log_warning = `Writes completed but import_log insert failed: ${logError.message}`
    }

    return json(response, failure ? 500 : 200)
  } catch (err) {
    return json({ error: err.message || 'Import failed.' }, 500)
  }
}
