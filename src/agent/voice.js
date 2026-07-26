import { describeFetchError } from './net.js'

const SPEECH_RMS = 0.02 // above this counts as speech
const SILENCE_MS = 900 // trailing silence that closes an utterance
const MIN_UTTERANCE_MS = 350 // ignore coughs and door slams
const FRAME_MS = 50

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ''
}

/**
 * Full-duplex voice channel: segments the microphone into utterances on
 * trailing silence, transcribes each through the server, and plays synthesized
 * replies with barge-in (user speech cancels playback).
 */
export function createVoice({ onTranscript, getLanguage = () => 'en', onError = () => {}, onState = () => {} }) {
  let stream = null
  let context = null
  let analyser = null
  let recorder = null
  let frameTimer = null
  let audio = null
  let speaking = false
  let listening = false
  let closed = false

  const buffer = new Uint8Array(2048)

  const rms = () => {
    analyser.getByteTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = (buffer[i] - 128) / 128
      sum += sample * sample
    }
    return Math.sqrt(sum / buffer.length)
  }

  function stopPlayback() {
    if (!audio) return
    audio.pause()
    URL.revokeObjectURL(audio.src)
    audio = null
    speaking = false
    onState({ speaking: false })
  }

  async function transcribe(blob) {
    if (blob.size < 2000) return
    try {
      const response = await fetch(`/api/agent/stt?language=${encodeURIComponent(getLanguage())}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `Transcription failed (HTTP ${response.status}).`)
      const text = (body.text || '').trim()
      if (text) onTranscript(text)
    } catch (error) {
      onError(describeFetchError(error, 'Transcription failed.'))
    }
  }

  function captureUtterance() {
    if (closed || !stream) return

    const mimeType = pickMimeType()
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks = []
    let heardSpeech = false
    let speechMs = 0
    let silenceMs = 0

    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = () => {
      clearInterval(frameTimer)
      frameTimer = null
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      recorder = null
      if (heardSpeech && speechMs >= MIN_UTTERANCE_MS) transcribe(blob)
      captureUtterance() // immediately arm the next utterance
    }

    recorder.start(200)

    frameTimer = setInterval(() => {
      const level = rms()
      const loud = level > SPEECH_RMS

      if (loud) {
        // Barge-in: the user talking over the reply cancels it.
        if (speaking) stopPlayback()
        heardSpeech = true
        speechMs += FRAME_MS
        silenceMs = 0
        return
      }

      if (!heardSpeech) return
      silenceMs += FRAME_MS
      if (silenceMs >= SILENCE_MS && recorder?.state === 'recording') recorder.stop()
    }, FRAME_MS)
  }

  return {
    async start() {
      if (listening) return
      closed = false
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      context = new (window.AudioContext || window.webkitAudioContext)()
      analyser = context.createAnalyser()
      analyser.fftSize = 2048
      context.createMediaStreamSource(stream).connect(analyser)
      listening = true
      onState({ listening: true })
      captureUtterance()
    },

    stop() {
      closed = true
      listening = false
      stopPlayback()
      clearInterval(frameTimer)
      frameTimer = null
      if (recorder?.state === 'recording') recorder.stop()
      recorder = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      context?.close()
      context = null
      analyser = null
      onState({ listening: false, speaking: false })
    },

    async speak(text) {
      const trimmed = String(text || '').trim()
      if (!trimmed) return
      stopPlayback()
      try {
        const response = await fetch('/api/agent/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: trimmed, language: getLanguage() }),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || `Speech synthesis failed (HTTP ${response.status}).`)
        }
        if (closed) return

        const url = URL.createObjectURL(await response.blob())
        audio = new Audio(url)
        speaking = true
        onState({ speaking: true })
        audio.onended = stopPlayback
        audio.onerror = stopPlayback
        await audio.play()
      } catch (error) {
        speaking = false
        onState({ speaking: false })
        onError(describeFetchError(error, 'Speech synthesis failed.'))
      }
    },

    stopSpeaking: stopPlayback,
  }
}
