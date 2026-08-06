// Offline test harness: exercises the command layer and the agent loop against
// mocks, with no network and no browser. Run: node scripts/selftest.mjs
import { createAgentCommands } from '../src/agent/commands.js'
import { createBrain } from '../src/agent/brain.js'
import { COMMAND_GROUPS, COMMAND_NAMES } from '../src/agent/catalog.js'
import { ANTHROPIC_TOOLS } from '../src/agent/schema.js'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) return
  failures += 1
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
}
const section = (name) => console.log(`\n== ${name} ==`)

// --- mock app -------------------------------------------------------------
function makeApi() {
  const state = {
    language: 'ar',
    activeBatch: {
      id: 'b1',
      title: 'دفعة اليوم',
      status: 'Draft',
      documentMeta: { date: '', location: '', counterName: '', columnHeaders: [], pageCount: 1, legibilityStatus: '' },
      unparsedRegions: [],
      rows: [
        { rowIndex: 1, itemName: 'سكر', sku: 'SKU-1', quantity: 10, unit: 'كيس', condition: 'جيد', status: 'ok', notes: '', confidence: 0.9, needsReview: false },
        { rowIndex: 2, itemName: 'مياه', sku: 'SKU-2', quantity: 5, unit: 'كرتونة', condition: 'جيد', status: 'ok', notes: '', confidence: 0.6, needsReview: true },
      ],
    },
    batches: [{ id: 'b1', title: 'دفعة اليوم', status: 'Draft', rows: [] }],
    stats: { totalItems: 2, totalUnits: 15, reviewCount: 1, completion: 50 },
    settings: { model: 'claude-haiku-4-5' },
    uploadedFiles: [],
    extracting: false,
    modelOptions: [
      { id: 'claude-opus-4-8', label: 'Opus' },
      { id: 'claude-sonnet-5', label: 'Sonnet' },
      { id: 'claude-haiku-4-5', label: 'Haiku' },
    ],
  }
  const calls = []
  const record = (name) => (...args) => { calls.push({ name, args }) }
  return {
    calls,
    state,
    ref: {
      current: {
        getState: () => state,
        setLanguage: (l) => { calls.push({ name: 'setLanguage', args: [l] }); state.language = l },
        setDrawerOpen: record('setDrawerOpen'),
        setShowSettings: record('setShowSettings'),
        setModel: record('setModel'),
        createNewBatch: record('createNewBatch'),
        saveCurrentBatch: record('saveCurrentBatch'),
        loadBatch: record('loadBatch'),
        runExtraction: async () => ({ ok: true, rowCount: 3, reviewCount: 1, unparsedRegions: [] }),
        exportWorkbook: record('exportWorkbook'),
        exportPdf: record('exportPdf'),
        patchRow: (i, patch) => { calls.push({ name: 'patchRow', args: [i, patch] }); Object.assign(state.activeBatch.rows[i], patch) },
        addRow: (partial) => { const row = { sku: 'SKU-N', unit: 'قطعة', ...partial }; state.activeBatch.rows.push(row); return row },
        deleteRow: (i) => { calls.push({ name: 'deleteRow', args: [i] }); state.activeBatch.rows.splice(i, 1) },
      },
    },
  }
}

const parse = (result) => JSON.parse(result)

// --- 1. catalog / schema / implementation stay in step --------------------
section('catalog integrity')
{
  const api = makeApi()
  const tools = createAgentCommands(api.ref)
  const implemented = Object.keys(tools)
  check('every catalogued command is implemented', COMMAND_NAMES.every((n) => implemented.includes(n)),
    COMMAND_NAMES.filter((n) => !implemented.includes(n)).join(','))
  check('no undocumented commands', implemented.every((n) => COMMAND_NAMES.includes(n)),
    implemented.filter((n) => !COMMAND_NAMES.includes(n)).join(','))
  check('tool schemas match command count', ANTHROPIC_TOOLS.length === COMMAND_NAMES.length)
  for (const tool of ANTHROPIC_TOOLS) {
    check(`${tool.name} has a description`, typeof tool.description === 'string' && tool.description.length > 10)
    check(`${tool.name} schema is an object type`, tool.input_schema.type === 'object')
    for (const [prop, spec] of Object.entries(tool.input_schema.properties)) {
      check(`${tool.name}.${prop} has a valid JSON type`,
        ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(spec.type), spec.type)
      check(`${tool.name}.${prop} is documented`, typeof spec.description === 'string' && spec.description.length > 0)
    }
    const required = tool.input_schema.required || []
    check(`${tool.name} required fields exist in properties`,
      required.every((r) => r in tool.input_schema.properties))
  }
  for (const group of COMMAND_GROUPS) {
    for (const command of group.commands) {
      check(`${command.name} has bilingual copy`, !!command.ar && !!command.en)
      check(`${command.name} has bilingual samples`, !!command.sampleAr && !!command.sampleEn)
    }
  }
}

// --- 2. every command, happy path ----------------------------------------
section('commands — happy path')
{
  const api = makeApi()
  const t = createAgentCommands(api.ref)

  check('get_summary reports counts', parse(t.get_summary()).totalItems === 2)
  check('list_items returns rows', parse(t.list_items({})).count === 2)
  check('list_items filters review-only', parse(t.list_items({ needs_review_only: true })).count === 1)
  check('find_item by name', parse(t.find_item({ query: 'سكر' })).item.sku === 'SKU-1')
  check('find_item by row number', parse(t.find_item({ query: '2' })).item.itemName === 'مياه')
  check('find_item by sku', parse(t.find_item({ query: 'SKU-2' })).item.itemName === 'مياه')
  check('find_item by substring', parse(t.find_item({ query: 'ميا' })).ok === true)

  check('update_item quantity coerces to number', (() => {
    const r = parse(t.update_item({ query: '1', field: 'quantity', value: '25' }))
    return r.ok && api.state.activeBatch.rows[0].quantity === 25
  })())
  check('update_item accepts field aliases', parse(t.update_item({ query: '1', field: 'qty', value: '30' })).ok)
  check('update_item boolean field', (() => {
    parse(t.update_item({ query: '1', field: 'needsReview', value: 'نعم' }))
    return api.state.activeBatch.rows[0].needsReview === true
  })())

  const added = parse(t.add_item({ item_name: 'شاي', quantity: 4, unit: 'علبة' }))
  check('add_item appends', added.ok && api.state.activeBatch.rows.length === 3)
  check('delete_item removes', (() => {
    const r = parse(t.delete_item({ query: 'شاي' }))
    return r.ok && api.state.activeBatch.rows.length === 2
  })())

  check('create_batch delegates', parse(t.create_batch()).ok && api.calls.some((c) => c.name === 'createNewBatch'))
  check('save_batch accepts a valid status', parse(t.save_batch({ status: 'Verified' })).saved === 'Verified')
  check('save_batch defaults to Draft', parse(t.save_batch({})).saved === 'Draft')
  check('list_batches returns batches', parse(t.list_batches()).batches.length === 1)
  check('load_batch by title', parse(t.load_batch({ query: 'دفعة اليوم' })).ok)
  check('set_language switches', parse(t.set_language({ language: 'en' })).language === 'en')
  check('set_model matches by id', parse(t.set_model({ model: 'claude-sonnet-5' })).model === 'claude-sonnet-5')
  check('open_panel history', parse(t.open_panel({ panel: 'history' })).opened === 'history')
  check('open_panel close', parse(t.open_panel({ panel: 'close' })).closed === true)
  check('export_data csv', parse(t.export_data({ format: 'csv' })).exported === 'csv')
  check('export_data pdf', parse(t.export_data({ format: 'pdf' })).exported === 'pdf')
}

// --- 3. failure paths return ok:false, never throw ------------------------
section('commands — failure paths')
{
  const api = makeApi()
  const t = createAgentCommands(api.ref)
  const failing = [
    ['find_item missing', () => t.find_item({ query: 'غير موجود' })],
    ['update_item unknown field', () => t.update_item({ query: '1', field: 'colour', value: 'red' })],
    ['update_item missing row', () => t.update_item({ query: 'nope', field: 'quantity', value: '1' })],
    ['add_item without a name', () => t.add_item({ item_name: '  ' })],
    ['delete_item missing', () => t.delete_item({ query: 'nope' })],
    ['export_data bad format', () => t.export_data({ format: 'docx' })],
    ['save_batch bad status', () => t.save_batch({ status: 'Whatever' })],
    ['load_batch missing', () => t.load_batch({ query: 'nope' })],
    ['set_language bad value', () => t.set_language({ language: 'fr' })],
    ['set_model unknown', () => t.set_model({ model: 'gpt-4' })],
    ['open_panel unknown', () => t.open_panel({ panel: 'sidebar' })],
  ]
  for (const [name, run] of failing) {
    let out
    try { out = parse(run()) } catch (error) { check(name, false, 'threw: ' + error.message); continue }
    check(name + ' returns ok:false', out.ok === false)
    check(name + ' explains why', typeof out.error === 'string' && out.error.length > 0)
  }

  check('run_extraction without images fails cleanly', parse(await t.run_extraction()).ok === false)
  api.state.uploadedFiles = [{}]
  check('run_extraction with images succeeds', parse(await t.run_extraction()).rowsExtracted === 3)
  api.state.extracting = true
  check('run_extraction refuses while busy', parse(await t.run_extraction()).ok === false)
}

// --- 4. empty-batch edge cases -------------------------------------------
section('commands — empty batch')
{
  const api = makeApi()
  api.state.activeBatch.rows = []
  api.state.batches = []
  const t = createAgentCommands(api.ref)
  check('get_summary on empty batch', parse(t.get_summary()).totalItems === 2)
  check('list_items on empty batch', parse(t.list_items({})).count === 0)
  check('export csv refuses empty batch', parse(t.export_data({ format: 'csv' })).ok === false)
  check('find_item on empty batch', parse(t.find_item({ query: 'x' })).ok === false)
  check('list_batches empty', parse(t.list_batches()).batches.length === 0)
  check('find_item with empty query', parse(t.find_item({ query: '' })).ok === false)
}

// --- 5. the agent loop ----------------------------------------------------
section('agent loop')
{
  const api = makeApi()
  const tools = createAgentCommands(api.ref)
  const sent = []
  let script = []

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    sent.push(body)
    const next = script.shift()
    if (next?.httpError) {
      return { ok: false, status: next.httpError, json: async () => ({ error: next.message }) }
    }
    return { ok: true, status: 200, json: async () => next }
  }

  // single tool round then a spoken answer
  script = [
    { content: [{ type: 'tool_use', id: 'tu1', name: 'get_summary', input: {} }] },
    { content: [{ type: 'text', text: 'صنفان، واحد يحتاج مراجعة.' }] },
  ]
  const events = []
  const brain = createBrain({ tools, getLanguage: () => 'ar', onEvent: (e) => events.push(e) })
  const reply = await brain.send('كام صنف؟')

  check('returns the spoken text', reply === 'صنفان، واحد يحتاج مراجعة.')
  check('emits a tool event', events.some((e) => e.type === 'tool' && e.name === 'get_summary'))
  check('emits the assistant text', events.some((e) => e.type === 'assistant'))
  check('sends the language through', sent[0].language === 'ar')
  check('second request carries tool_result', (() => {
    const last = sent[1].messages[sent[1].messages.length - 1]
    return last.role === 'user' && last.content[0].type === 'tool_result' && last.content[0].tool_use_id === 'tu1'
  })())
  check('assistant content is echoed back verbatim', (() => {
    const assistant = sent[1].messages.find((m) => m.role === 'assistant')
    return assistant && assistant.content[0].type === 'tool_use'
  })())

  // parallel tool calls must come back in ONE user message
  script = [
    { content: [
      { type: 'tool_use', id: 'a', name: 'get_summary', input: {} },
      { type: 'tool_use', id: 'b', name: 'list_batches', input: {} },
    ] },
    { content: [{ type: 'text', text: 'done' }] },
  ]
  sent.length = 0
  const brain2 = createBrain({ tools, getLanguage: () => 'en', onEvent: () => {} })
  await brain2.send('two things')
  check('parallel tool_results share one message', (() => {
    const last = sent[1].messages[sent[1].messages.length - 1]
    return last.content.length === 2 && last.content.every((b) => b.type === 'tool_result')
  })())

  // unknown tool name must not throw
  script = [
    { content: [{ type: 'tool_use', id: 'x', name: 'not_a_tool', input: {} }] },
    { content: [{ type: 'text', text: 'recovered' }] },
  ]
  sent.length = 0
  const brain3 = createBrain({ tools, getLanguage: () => 'en', onEvent: () => {} })
  check('unknown tool recovers', (await brain3.send('go')) === 'recovered')
  check('unknown tool marked is_error', sent[1].messages.at(-1).content[0].is_error === true)

  // a failing tool is reported, not thrown
  script = [
    { content: [{ type: 'tool_use', id: 'y', name: 'find_item', input: { query: 'nope' } }] },
    { content: [{ type: 'text', text: 'not found' }] },
  ]
  const brain4 = createBrain({ tools, getLanguage: () => 'en', onEvent: () => {} })
  check('tool returning ok:false still completes', (await brain4.send('find')) === 'not found')

  // HTTP failure surfaces as an error event
  script = [{ httpError: 500, message: 'boom' }]
  const errEvents = []
  const brain5 = createBrain({ tools, getLanguage: () => 'en', onEvent: (e) => errEvents.push(e) })
  const failed = await brain5.send('hi')
  check('http error returns empty string', failed === '')
  check('http error emits an error event', errEvents.some((e) => e.type === 'error' && e.text.includes('boom')))

  // runaway tool loop is capped
  script = Array.from({ length: 20 }, () => ({ content: [{ type: 'tool_use', id: 'z', name: 'get_summary', input: {} }] }))
  const loopEvents = []
  const brain6 = createBrain({ tools, getLanguage: () => 'en', onEvent: (e) => loopEvents.push(e) })
  await brain6.send('loop')
  check('tool rounds are capped', loopEvents.some((e) => e.type === 'error' && /too many tool calls/i.test(e.text)))

  // long conversations must never start with a tool_result or an assistant turn
  const brain7 = createBrain({ tools, getLanguage: () => 'en', onEvent: () => {} })
  for (let i = 0; i < 20; i += 1) {
    script = [
      { content: [{ type: 'tool_use', id: 't' + i, name: 'get_summary', input: {} }] },
      { content: [{ type: 'text', text: 'ok ' + i }] },
    ]
    sent.length = 0
    await brain7.send('turn ' + i)
    const first = sent.at(-1).messages[0]
    check(`turn ${i}: history starts with a user message`, first.role === 'user', 'got ' + first.role)
    check(`turn ${i}: history does not start with a tool_result`,
      !(Array.isArray(first.content) && first.content.some((b) => b.type === 'tool_result')))
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
