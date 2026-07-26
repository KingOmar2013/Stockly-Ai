import { apiUrl } from './agent/net.js'
const MAX_IMAGE_EDGE = 2576

async function preprocessImage(file, { brightness = 100, contrast = 100, rotation = 0 }) {
  const bitmap = await createImageBitmap(file)
  const rad = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const rotatedWidth = bitmap.width * cos + bitmap.height * sin
  const rotatedHeight = bitmap.width * sin + bitmap.height * cos
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(rotatedWidth, rotatedHeight))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(rotatedWidth * scale)
  canvas.height = Math.round(rotatedHeight * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(rad)
  ctx.scale(scale, scale)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    },
  }
}

export async function extractInventory({ apiKey, model, files, adjustments = {} }) {
  if (!files?.length) {
    throw new Error('ارفع صورة واحدة على الأقل بصيغة JPEG أو PNG أو WebP.')
  }

  const supported = files.filter((file) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type),
  )

  if (!supported.length) {
    throw new Error('ارفع صورة واحدة على الأقل بصيغة JPEG أو PNG أو WebP.')
  }

  const imageBlocks = await Promise.all(supported.map((file) => preprocessImage(file, adjustments)))

  const response = await fetch(apiUrl('/api/extract'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'claude-haiku-4-5', imageBlocks, supportedCount: supported.length }),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new Error(errorBody.error || 'تعذر الاتصال بخادم الاستخراج.')
  }

  return response.json()
}

export function describeExtractionError(error) {
  return error.message || 'حدث خطأ غير متوقع أثناء الاستخراج.'
}
