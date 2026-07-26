import express from 'express'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Anthropic } from '@anthropic-ai/sdk'
import { ANTHROPIC_TOOLS } from './src/agent/schema.js'

const app = express()

// When the frontend is served from a static host (GitHub Pages) it calls this
// server cross-origin. ALLOWED_ORIGIN is a comma-separated allowlist; unset
// means same-origin only, which is what local development uses.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use((req, res, next) => {
  const origin = req.get('origin')
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && allowedOrigins.includes(origin) ? 204 : 403)
  return next()
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.use(express.json({ limit: '20mb' }))

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentMeta', 'rows', 'unparsedRegions'],
  properties: {
    documentMeta: {
      type: 'object',
      additionalProperties: false,
      required: ['date', 'location', 'counterName', 'columnHeaders', 'pageCount', 'legibilityStatus'],
      properties: {
        date: { type: 'string', description: 'تاريخ ورقة الجرد كما هو مكتوب، أو سلسلة فارغة' },
        location: { type: 'string', description: 'موقع المخزن أو الفرع، أو سلسلة فارغة' },
        counterName: { type: 'string', description: 'اسم من قام بالعد، أو سلسلة فارغة' },
        columnHeaders: { type: 'array', items: { type: 'string' }, description: 'عناوين الأعمدة كما تظهر في الورقة' },
        pageCount: { type: 'integer' },
        legibilityStatus: { type: 'string', description: 'تقييم وضوح الخط: جيد / متوسط / ضعيف' },
      },
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemName', 'sku', 'quantity', 'unit', 'condition', 'status', 'notes', 'confidence', 'needsReview'],
        properties: {
          itemName: { type: 'string' },
          sku: { type: 'string', description: 'رمز الصنف إن وجد، وإلا سلسلة فارغة' },
          quantity: { type: 'number' },
          unit: { type: 'string', description: 'الوحدة: قطعة، كرتونة، علبة…' },
          condition: { type: 'string', description: 'حالة الصنف: جيد، ممتلئ، تالف' },
          status: { type: 'string', description: 'تم التحقق أو قيد المراجعة' },
          notes: { type: 'string' },
          confidence: { type: 'number', description: 'ثقة القراءة من 0 إلى 1' },
          needsReview: { type: 'boolean', description: 'true إذا كانت القراءة غير مؤكدة' },
        },
      },
    },
    unparsedRegions: {
      type: 'array',
      items: { type: 'string' },
      description: 'وصف لأي مناطق في الصور تعذّر فك محتواها',
    },
  },
}

const SYSTEM_PROMPT = `أنت محرك استخراج بصري متخصص في رقمنة أوراق الجرد المكتوبة بخط اليد أو المطبوعة باللغة العربية.
مهمتك: قراءة صور أوراق الجرد المرفقة واستخراج كل صف من صفوف الأصناف بدقة.

قواعد صارمة:
- انسخ أسماء الأصناف كما هي مكتوبة دون تصحيح إملائي إلا عند الضرورة الواضحة.
- إذا كان حقل غير مقروء أو غير موجود، ضع سلسلة فارغة ولا تخترع قيمة.
- الكميات أرقام فقط؛ إذا كان الرقم غير واضح ضع أفضل تقدير واخفض قيمة confidence وضع needsReview = true.
- confidence بين 0 و 1 لكل صف حسب وضوح القراءة؛ أي صف تحت 0.8 يجب أن يكون needsReview = true.
- سجّل في unparsedRegions وصفاً لأي جزء من الصفحة تعذّر فكّه (مثال: "العمود الأخير في الصفحة 2 مطموس").
- لا تدمج صفوفاً ولا تحذف صفوفاً مكررة؛ أخرج الورقة كما هي.`

app.post('/api/extract', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'The server is missing ANTHROPIC_API_KEY.' })
    }

    const { model = 'claude-haiku-4-5', imageBlocks = [], supportedCount = imageBlocks.length } = req.body || {}
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `هذه ${supportedCount} صفحة من ورقة جرد. استخرج البيانات كاملة حسب المخطط المطلوب.`,
            },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      return res.status(400).json({ error: 'The model refused to process the request.' })
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(413).json({ error: 'The document exceeds the output limit for one request.' })
    }

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock) {
      return res.status(502).json({ error: 'The model did not return any text output.' })
    }

    return res.json(JSON.parse(textBlock.text))
  } catch (error) {
    const message = error?.message || 'Extraction failed.'
    return res.status(502).json({ error: message })
  }
})

// ---------------------------------------------------------------------------
// Voice assistant: Claude is the brain, ElevenLabs only does speech in/out.
// Tools execute in the browser, so this endpoint is stateless — the client
// holds the transcript and posts the full history each turn.
// ---------------------------------------------------------------------------

const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-opus-5'
const AGENT_SYSTEM_PROMPT = readFileSync(new URL('./scripts/agent-prompt.txt', import.meta.url), 'utf8').trim()

app.post('/api/agent/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'The server is missing ANTHROPIC_API_KEY.' })
  }

  const { messages = [], language = 'en' } = req.body || {}
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages is required.' })
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 8192,
      system: `${AGENT_SYSTEM_PROMPT}\n\nThe interface language is currently "${language}".`,
      // Voice replies are spoken aloud: low effort keeps latency down while
      // leaving adaptive thinking on, which keeps tool calls well-formed.
      output_config: { effort: 'low' },
      // Claude Opus 5 safety classifiers can decline a request; route those to
      // Anthropic's recommended fallback instead of failing the turn.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: ANTHROPIC_TOOLS,
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return res.status(400).json({ error: 'The model declined this request.' })
    }

    return res.json({
      stopReason: response.stop_reason,
      content: response.content,
      model: response.model,
    })
  } catch (error) {
    const status = error?.status && error.status >= 400 && error.status < 600 ? error.status : 502
    return res.status(status).json({ error: error?.message || 'The assistant is unavailable.' })
  }
})

// Speech to text. Body is the raw recorded audio blob from the browser.
app.post('/api/agent/stt', express.raw({ type: 'audio/*', limit: '25mb' }), async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'The server is missing ELEVENLABS_API_KEY.' })
  if (!req.body?.length) return res.status(400).json({ error: 'No audio received.' })

  try {
    const form = new FormData()
    const type = req.get('content-type') || 'audio/webm'
    const extension = (type.split(';')[0].split('/')[1] || 'webm').replace('mpeg', 'mp3')
    form.append('file', new Blob([req.body], { type }), `speech.${extension}`)
    form.append('model_id', 'scribe_v1')

    // Without a hint Scribe guesses from the audio and misreads short Arabic
    // clips as other scripts. The UI language is the best hint we have.
    const hint = String(req.query.language || '').toLowerCase()
    if (hint.startsWith('ar')) form.append('language_code', 'ara')
    else if (hint.startsWith('en')) form.append('language_code', 'eng')

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    })
    const body = await response.json()
    if (!response.ok) {
      return res.status(response.status).json({ error: body?.detail?.message || 'Transcription failed.' })
    }
    return res.json({ text: (body.text || '').trim(), language: body.language_code || '' })
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Transcription failed.' })
  }
})

// Text to speech. Streams mp3 straight back to the browser.
app.post('/api/agent/tts', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY
  // Per-language voices fall back to ELEVENLABS_VOICE_ID when unset, so one
  // variable still works for both languages.
  const language = String(req.body?.language || '').toLowerCase()
  const perLanguage = language.startsWith('ar')
    ? process.env.ELEVENLABS_VOICE_ID_AR
    : language.startsWith('en')
      ? process.env.ELEVENLABS_VOICE_ID_EN
      : ''
  const voiceId = perLanguage || process.env.ELEVENLABS_VOICE_ID
  if (!apiKey || !voiceId) {
    return res.status(500).json({ error: 'The server is missing ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID.' })
  }

  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'text is required.' })

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        // flash v2.5 is the low-latency multilingual model; it covers Arabic.
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5' }),
      },
    )

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      return res.status(response.status).json({ error: body?.detail?.message || 'Speech synthesis failed.' })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    return Readable.fromWeb(response.body).pipe(res)
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Speech synthesis failed.' })
  }
})

// The Netlify function imports `app` and wraps it; only listen when this file
// is executed directly (local dev, or a plain Node host such as Render).
export { app }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001)
  app.listen(port, () => {
    console.log(`Stockly API listening on http://localhost:${port}`)
  })
}
