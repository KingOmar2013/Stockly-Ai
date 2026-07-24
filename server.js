import express from 'express'
import { Anthropic } from '@anthropic-ai/sdk'

const app = express()
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

const port = Number(process.env.PORT || 3001)
app.listen(port, () => {
  console.log(`Stockly OCR proxy listening on http://localhost:${port}`)
})
