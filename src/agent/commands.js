import { COMMAND_NAMES } from './catalog.js'

const ROW_FIELDS = {
  name: 'itemName',
  itemname: 'itemName',
  item: 'itemName',
  sku: 'sku',
  code: 'sku',
  quantity: 'quantity',
  qty: 'quantity',
  unit: 'unit',
  condition: 'condition',
  status: 'status',
  notes: 'notes',
  note: 'notes',
  needsreview: 'needsReview',
  review: 'needsReview',
}

const NUMERIC_FIELDS = new Set(['quantity'])
const BOOLEAN_FIELDS = new Set(['needsReview'])
const TRUTHY = new Set(['true', '1', 'yes', 'y', 'نعم', 'صح'])

const norm = (value) => String(value ?? '').trim().toLowerCase()
const ok = (data) => JSON.stringify({ ok: true, ...data })
const fail = (error) => JSON.stringify({ ok: false, error })

function resolveField(field) {
  return ROW_FIELDS[norm(field).replace(/[\s_-]/g, '')] || null
}

function coerce(field, value) {
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return typeof value === 'boolean' ? value : TRUTHY.has(norm(value))
  }
  return String(value ?? '')
}

function findRowIndex(rows, query) {
  const q = norm(query)
  if (!q) return -1

  const asIndex = Number(q)
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= rows.length) return asIndex - 1

  const bySku = rows.findIndex((row) => norm(row.sku) === q)
  if (bySku !== -1) return bySku

  const exact = rows.findIndex((row) => norm(row.itemName) === q)
  if (exact !== -1) return exact

  return rows.findIndex((row) => norm(row.itemName).includes(q))
}

function slimRow(row, index) {
  return {
    index: index + 1,
    itemName: row.itemName,
    sku: row.sku,
    quantity: row.quantity,
    unit: row.unit,
    condition: row.condition,
    status: row.status,
    notes: row.notes,
    confidence: row.confidence,
    needsReview: row.needsReview,
  }
}

/**
 * Builds the tool map Claude drives from the browser. `apiRef` is a React ref that App keeps
 * pointed at the current render's state and actions, so tools never close over
 * stale values.
 */
export function createAgentCommands(apiRef) {
  const api = () => apiRef.current

  const tools = {
    get_summary: () => {
      const { activeBatch, stats, batches, language } = api().getState()
      return ok({
        language,
        batchTitle: activeBatch.title,
        batchStatus: activeBatch.status,
        totalItems: stats.totalItems,
        totalUnits: stats.totalUnits,
        needsReview: stats.reviewCount,
        completionPercent: stats.completion,
        savedBatches: batches.length,
        documentMeta: activeBatch.documentMeta,
        unparsedRegions: activeBatch.unparsedRegions ?? [],
      })
    },

    list_items: ({ needs_review_only = false, limit = 25 } = {}) => {
      const { activeBatch } = api().getState()
      const items = activeBatch.rows
        .map(slimRow)
        .filter((row) => (needs_review_only ? row.needsReview : true))
        .slice(0, Math.max(1, Math.min(Number(limit) || 25, 200)))
      return ok({ count: items.length, totalInBatch: activeBatch.rows.length, items })
    },

    find_item: ({ query }) => {
      const { activeBatch } = api().getState()
      const index = findRowIndex(activeBatch.rows, query)
      if (index === -1) return fail(`No item matches "${query}".`)
      return ok({ item: slimRow(activeBatch.rows[index], index) })
    },

    update_item: ({ query, field, value }) => {
      const { activeBatch } = api().getState()
      const key = resolveField(field)
      if (!key) return fail(`Unknown field "${field}". Allowed: itemName, sku, quantity, unit, condition, status, notes, needsReview.`)

      const index = findRowIndex(activeBatch.rows, query)
      if (index === -1) return fail(`No item matches "${query}".`)

      api().patchRow(index, { [key]: coerce(key, value) })
      return ok({ updated: { index: index + 1, field: key, value: coerce(key, value) } })
    },

    add_item: ({ item_name, quantity = 1, unit = '', sku = '', notes = '' }) => {
      if (!String(item_name || '').trim()) return fail('item_name is required.')
      const row = api().addRow({
        itemName: String(item_name).trim(),
        quantity: coerce('quantity', quantity),
        ...(unit ? { unit: String(unit) } : {}),
        ...(sku ? { sku: String(sku) } : {}),
        notes: String(notes || ''),
      })
      return ok({ added: { itemName: row.itemName, sku: row.sku, quantity: row.quantity } })
    },

    delete_item: ({ query }) => {
      const { activeBatch } = api().getState()
      const index = findRowIndex(activeBatch.rows, query)
      if (index === -1) return fail(`No item matches "${query}".`)
      const removed = activeBatch.rows[index].itemName
      api().deleteRow(index)
      return ok({ deleted: { index: index + 1, itemName: removed } })
    },

    run_extraction: async () => {
      const { uploadedFiles, extracting } = api().getState()
      if (extracting) return fail('An extraction is already running.')
      if (!uploadedFiles.length) return fail('No images uploaded. Ask the user to upload inventory sheet images first.')

      const result = await api().runExtraction()
      if (!result.ok) return fail(result.error)
      return ok({
        rowsExtracted: result.rowCount,
        needsReview: result.reviewCount,
        unparsedRegions: result.unparsedRegions,
      })
    },

    export_data: ({ format }) => {
      const target = norm(format)
      if (target === 'pdf') {
        api().exportPdf()
        return ok({ exported: 'pdf' })
      }
      if (target !== 'csv' && target !== 'xlsx') return fail('format must be one of: csv, xlsx, pdf.')
      const { activeBatch } = api().getState()
      if (!activeBatch.rows.length) return fail('The batch is empty, nothing to export.')
      api().exportWorkbook(target)
      return ok({ exported: target, rows: activeBatch.rows.length })
    },

    create_batch: () => {
      api().createNewBatch()
      return ok({ created: true })
    },

    save_batch: ({ status = 'Draft' } = {}) => {
      const allowed = ['Draft', 'Pending', 'Verified', 'Synced']
      const match = allowed.find((item) => norm(item) === norm(status))
      if (!match) return fail(`status must be one of: ${allowed.join(', ')}.`)
      api().saveCurrentBatch(match)
      return ok({ saved: match })
    },

    list_batches: () => {
      const { batches } = api().getState()
      return ok({
        batches: batches.map((batch) => ({
          id: batch.id,
          title: batch.title,
          status: batch.status,
          rows: batch.rows.length,
        })),
      })
    },

    load_batch: ({ query }) => {
      const { batches } = api().getState()
      const q = norm(query)
      const batch =
        batches.find((item) => norm(item.id) === q) ||
        batches.find((item) => norm(item.title) === q) ||
        batches.find((item) => norm(item.title).includes(q))
      if (!batch) return fail(`No batch matches "${query}".`)
      api().loadBatch(batch.id)
      return ok({ loaded: { id: batch.id, title: batch.title, rows: batch.rows.length } })
    },

    set_language: ({ language }) => {
      const next = norm(language).startsWith('ar') ? 'ar' : norm(language).startsWith('en') ? 'en' : null
      if (!next) return fail('language must be "ar" or "en".')
      api().setLanguage(next)
      return ok({ language: next })
    },

    set_model: ({ model }) => {
      const { modelOptions } = api().getState()
      const match = modelOptions.find((item) => norm(item.id) === norm(model) || norm(item.label) === norm(model))
      if (!match) return fail(`model must be one of: ${modelOptions.map((item) => item.id).join(', ')}.`)
      api().setModel(match.id)
      return ok({ model: match.id })
    },

    open_panel: ({ panel }) => {
      const target = norm(panel)
      if (target === 'history') {
        api().setDrawerOpen(true)
        return ok({ opened: 'history' })
      }
      if (target === 'settings') {
        api().setShowSettings(true)
        return ok({ opened: 'settings' })
      }
      if (target === 'close') {
        api().setDrawerOpen(false)
        api().setShowSettings(false)
        return ok({ closed: true })
      }
      return fail('panel must be one of: history, settings, close.')
    },
  }

  const implemented = Object.keys(tools)
  const missing = COMMAND_NAMES.filter((name) => !implemented.includes(name))
  const undocumented = implemented.filter((name) => !COMMAND_NAMES.includes(name))
  if (missing.length || undocumented.length) {
    console.warn('[agent] catalog/implementation mismatch', { missing, undocumented })
  }

  return tools
}
