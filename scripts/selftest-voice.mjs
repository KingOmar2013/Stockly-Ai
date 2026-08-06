// Drives voice.js headless with stubbed browser audio APIs. Frames are stepped
// manually, so the whole state machine runs in milliseconds.
let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) return
  failures += 1
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
}

// --- browser stubs --------------------------------------------------------
let level = 0 // current mic RMS, driven by the tests
let frameFn = null
let clock = 0 // fake wall clock: each stepped frame advances it by FRAME_MS
globalThis.performance = { now: () => clock }

globalThis.setInterval = (fn) => { frameFn = fn; return 1 }
globalThis.clearInterval = () => { frameFn = null }
const step = (frames = 1) => { for (let i = 0; i < frames; i += 1) { clock += 50; frameFn?.() } }

class FakeRecorder {
  constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; this.events = [] }
  start() { this.state = 'recording' }
  pause() { this.state = 'paused'; this.events.push('pause') }
  resume() { this.state = 'recording'; this.events.push('resume') }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: { size: 5000 } })
    this.onstop?.()
  }
}
let recorders = []
globalThis.MediaRecorder = function () { const r = new FakeRecorder(); recorders.push(r); return r }
globalThis.MediaRecorder.isTypeSupported = () => true

globalThis.window = { MediaRecorder: globalThis.MediaRecorder, AudioContext: function () {
  return {
    createAnalyser: () => ({ fftSize: 0, getByteTimeDomainData: (buf) => {
      // Encode `level` as a constant offset from the 128 midpoint.
      const amplitude = Math.round(level * 128)
      for (let i = 0; i < buf.length; i += 1) buf[i] = 128 + amplitude
    } }),
    createMediaStreamSource: () => ({ connect: () => {} }),
    close: () => {},
  }
} }

globalThis.navigator = { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) } }
globalThis.Blob = class { constructor(parts) { this.size = 5000; this.type = 'audio/webm'; this.parts = parts } }
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }

let playing = null
globalThis.Audio = class { constructor(src) { this.src = src; playing = this } async play() { return undefined } pause() {} }

const transcribed = []
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/agent/stt')) {
    transcribed.push(1)
    return { ok: true, status: 200, json: async () => ({ text: 'ضيف خمس كراتين مياه', language: 'ara' }) }
  }
  return { ok: true, status: 200, blob: async () => new globalThis.Blob([]) }
}

const { createVoice } = await import('../src/agent/voice.js')

// --- tests ----------------------------------------------------------------
const heard = []
const states = []
const voice = createVoice({
  onTranscript: (t) => heard.push(t),
  getLanguage: () => 'ar',
  onError: (e) => console.log('  (error event)', e),
  onState: (s) => states.push(s),
})

await voice.start()
check('starts listening', states.some((s) => s.listening === true))
check('arms a recorder', recorders.length === 1 && recorders[0].state === 'recording')

console.log('\n== utterance segmentation ==')
level = 0.1 // speech
step(10) // 500ms of speech
level = 0 // silence
step(17) // 850ms — just under the 900ms threshold
check('does not close before the silence threshold', recorders[0].state === 'recording')
step(2) // crosses 900ms
check('closes the utterance after trailing silence', recorders[0].state === 'inactive')
await new Promise((r) => setTimeout(r, 0))
check('transcribes the closed utterance', transcribed.length === 1)
check('reports the transcript', heard[0] === 'ضيف خمس كراتين مياه')
check('re-arms for the next utterance', recorders.length === 2 && recorders[1].state === 'recording')

console.log('\n== short noise is discarded ==')
const before = transcribed.length
level = 0.1
step(4) // 200ms — under MIN_UTTERANCE_MS
level = 0
step(20)
await new Promise((r) => setTimeout(r, 0))
check('ignores sub-threshold noise', transcribed.length === before)

console.log('\n== playback, echo, and barge-in ==')
const active = () => recorders[recorders.length - 1]
await voice.speak('أربعة عشر صنفاً')
check('marks itself as speaking', states.some((s) => s.speaking === true))
check('pauses recording while speaking', active().state === 'paused')

level = 0.05 // the assistant's own voice leaking back — above speech, below barge-in
step(40) // 2s of it
check('own voice does not cancel playback', playing !== null && active().state === 'paused')

level = 0.15 // a real interruption, loud
step(3) // 150ms — below BARGE_IN_MS
check('brief loud noise does not cancel playback', active().state === 'paused')
step(6) // now past 350ms sustained
check('sustained loud speech cancels playback', active().state === 'recording')
check('resumes recording after barge-in', active().events.includes('resume'))
check('reports speaking:false', states.at(-1).speaking === false)

console.log('\n== grace period ==')
level = 0
const voice2 = createVoice({ onTranscript: () => {}, getLanguage: () => 'ar', onError: () => {}, onState: () => {} })
await voice2.start()
await voice2.speak('test')
level = 0.5 // extremely loud immediately
step(8) // 400ms — sustained, but inside the 600ms grace window
check('ignores loud audio inside the grace window', recorders[recorders.length - 1].state === 'paused')
step(6) // past the grace window
check('cancels once past the grace window', recorders[recorders.length - 1].state === 'recording')

console.log('\n== teardown ==')
voice.stop()
voice2.stop()
check('stop() reports not listening', states.at(-1).listening === false)

console.log(failures === 0 ? '\nAll voice checks passed.' : `\n${failures} voice check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
