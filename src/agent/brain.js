import { apiUrl, describeFetchError, describeHttpError } from './net.js'

const MAX_TOOL_ROUNDS = 8
const MAX_HISTORY_TURNS = 24

function textOf(content) {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * Drives the Claude tool-use loop from the browser: the server proxies each
 * turn to the Messages API, tool_use blocks are executed locally against the
 * app, and tool_result blocks go back on the next request. History lives here,
 * so the proxy stays stateless.
 *
 * @param tools   command map from createAgentCommands()
 * @param onEvent ({ type, ... }) — 'assistant' | 'tool' | 'error'
 */
export function createBrain({ tools, getLanguage = () => 'en', onEvent = () => {} }) {
  let history = []
  let busy = false

  // A trimmed history has to begin on a plain user turn: the API rejects a
  // conversation that opens with an assistant message, and it rejects a
  // tool_result whose matching tool_use was dropped. Advance past both.
  const isSafeStart = (message) =>
    message.role === 'user' &&
    !(Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_result'))

  const trim = () => {
    if (history.length <= MAX_HISTORY_TURNS) return
    let cut = history.length - MAX_HISTORY_TURNS
    while (cut < history.length && !isSafeStart(history[cut])) cut += 1
    if (cut >= history.length) return // nothing safe to cut to; keep the history
    history = history.slice(cut)
  }

  async function turn() {
    const response = await fetch(apiUrl('/api/agent/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, language: getLanguage() }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(describeHttpError(response.status, body.error, 'The assistant is unavailable.'))
    return body
  }

  async function runTool(block) {
    const tool = tools[block.name]
    if (!tool) {
      return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Unknown tool: ${block.name}` }
    }
    try {
      const result = await tool(block.input || {})
      onEvent({ type: 'tool', name: block.name, input: block.input, result })
      return { type: 'tool_result', tool_use_id: block.id, content: String(result ?? '{"ok":true}') }
    } catch (error) {
      const message = error?.message || 'Tool execution failed.'
      onEvent({ type: 'tool', name: block.name, input: block.input, result: message, failed: true })
      return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: message }
    }
  }

  async function send(userText) {
    if (busy) return ''
    busy = true
    history.push({ role: 'user', content: [{ type: 'text', text: userText }] })

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const { content } = await turn()

        // Push the full content array back unchanged — thinking and tool_use
        // blocks must survive verbatim for the next request to validate.
        history.push({ role: 'assistant', content })
        trim()

        const spoken = textOf(content)
        if (spoken) onEvent({ type: 'assistant', text: spoken })

        const toolUses = content.filter((block) => block.type === 'tool_use')
        if (!toolUses.length) return spoken

        const results = await Promise.all(toolUses.map(runTool))
        history.push({ role: 'user', content: results })
      }

      const message = 'The assistant used too many tool calls in one turn.'
      onEvent({ type: 'error', text: message })
      return ''
    } catch (error) {
      onEvent({ type: 'error', text: describeFetchError(error, 'The assistant failed.') })
      return ''
    } finally {
      busy = false
    }
  }

  return {
    send,
    reset: () => {
      history = []
    },
    get busy() {
      return busy
    },
  }
}
