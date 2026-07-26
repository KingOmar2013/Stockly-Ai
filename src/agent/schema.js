import { COMMAND_GROUPS } from './catalog.js'

/**
 * LLM-facing parameter docs, keyed by `${tool}.${param}`. Kept next to the schema
 * builder so the browser bundle and the node scripts share one source.
 */
export const PARAM_DOCS = {
  'list_items.needs_review_only': 'Return only rows flagged as needing review.',
  'list_items.limit': 'Maximum number of rows to return. Defaults to 25.',
  'find_item.query': 'A 1-based row number, a SKU, or an item name (exact match first, then substring).',
  'update_item.query': 'A 1-based row number, a SKU, or an item name.',
  'update_item.field': 'Field to change: itemName, sku, quantity, unit, condition, status, notes, or needsReview.',
  'update_item.value': 'New value for the field, as text. Quantities are parsed as numbers.',
  'add_item.item_name': 'Name of the item, transcribed exactly as the user said it.',
  'add_item.quantity': 'Counted quantity. Defaults to 1.',
  'add_item.unit': 'Unit of measure, e.g. piece, carton, box.',
  'add_item.sku': 'Item code, if the user gave one.',
  'add_item.notes': 'Free-text note about the item.',
  'delete_item.query': 'A 1-based row number, a SKU, or an item name.',
  'export_data.format': 'Export target. pdf opens the browser print dialog.',
  'save_batch.status': 'Status to store the batch under.',
  'load_batch.query': 'Batch id or title, full or partial.',
  'set_language.language': 'UI language to switch to.',
  'set_model.model': 'Extraction model id: claude-opus-4-8, claude-sonnet-5, or claude-haiku-4-5.',
  'open_panel.panel': 'Which panel to open, or close to dismiss both.',
}

export function jsonSchemaFor(command, docs = PARAM_DOCS) {
  const properties = {}
  const required = []

  for (const param of command.params) {
    const options = param.type.includes('|') ? param.type.split('|').map((value) => value.trim()) : null
    properties[param.name] = {
      type: options ? 'string' : param.type,
      description: docs[`${command.name}.${param.name}`] || param.name,
      ...(options ? { enum: options } : {}),
    }
    if (param.required) required.push(param.name)
  }

  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

/** Tool definitions in Anthropic Messages API shape. */
export const ANTHROPIC_TOOLS = COMMAND_GROUPS.flatMap((group) =>
  group.commands.map((command) => ({
    name: command.name,
    description: command.en,
    input_schema: jsonSchemaFor(command),
  })),
)
