import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Send, X, Bot } from 'lucide-react'
import { createAgentCommands } from './commands'
import { createBrain } from './brain'
import { createVoice } from './voice'
import './agent.css'

const COPY = {
  ar: {
    title: 'مساعد Stockly',
    open: 'افتح المساعد',
    close: 'إغلاق',
    call: 'اتصال',
    endCall: 'إنهاء',
    placeholder: 'اكتب رسالتك…',
    send: 'إرسال',
    idle: 'جاهز',
    listening: 'ينصت إليك',
    speaking: 'المساعد يتحدث',
    thinking: 'جارٍ التنفيذ…',
    micDenied: 'تعذر الوصول إلى الميكروفون.',
    empty: 'ابدأ اتصالاً صوتياً أو اكتب رسالة.',
    muted: 'الميكروفون مكتوم',
  },
  en: {
    title: 'Stockly Assistant',
    open: 'Open assistant',
    close: 'Close',
    call: 'Call',
    endCall: 'End call',
    placeholder: 'Type a message…',
    send: 'Send',
    idle: 'Ready',
    listening: 'Listening',
    speaking: 'Speaking',
    thinking: 'Working…',
    micDenied: 'Microphone access was denied.',
    empty: 'Start a voice call or type a message.',
    muted: 'Microphone muted',
  },
}

export default function StocklyAgent({ apiRef, language = 'en' }) {
  const t = COPY[language] ?? COPY.en
  const [open, setOpen] = useState(false)
  const [transcript, setTranscript] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [thinking, setThinking] = useState(false)
  const [onCall, setOnCall] = useState(false)
  const [voiceState, setVoiceState] = useState({ listening: false, speaking: false })
  const logRef = useRef(null)
  const voiceRef = useRef(null)
  const onCallRef = useRef(false)
  const languageRef = useRef(language)
  languageRef.current = language

  const append = useCallback((role, text) => {
    setTranscript((current) => {
      const last = current[current.length - 1]
      if (last && last.role === role && last.text === text) return current
      return [...current, { role, text }]
    })
  }, [])

  const brain = useMemo(
    () =>
      createBrain({
        tools: createAgentCommands(apiRef),
        getLanguage: () => languageRef.current,
        onEvent: (event) => {
          if (event.type === 'assistant') {
            append('agent', event.text)
            if (onCallRef.current) voiceRef.current?.speak(event.text)
          } else if (event.type === 'tool') {
            append('tool', `${event.name}${event.failed ? ' — failed' : ''}`)
          } else if (event.type === 'error') {
            setError(event.text)
          }
        },
      }),
    [apiRef, append],
  )

  const ask = useCallback(
    async (text) => {
      setError('')
      setThinking(true)
      try {
        await brain.send(text)
      } finally {
        setThinking(false)
      }
    },
    [brain],
  )

  // One voice channel for the component's lifetime; transcripts feed the brain.
  useEffect(() => {
    voiceRef.current = createVoice({
      getLanguage: () => languageRef.current,
      onTranscript: (text) => {
        append('user', text)
        ask(text)
      },
      onError: setError,
      onState: (patch) => setVoiceState((current) => ({ ...current, ...patch })),
    })
    return () => voiceRef.current?.stop()
  }, [append, ask])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [transcript, open])

  const startCall = useCallback(async () => {
    setError('')
    try {
      await voiceRef.current.start()
      onCallRef.current = true
      setOnCall(true)
    } catch {
      setError(t.micDenied)
    }
  }, [t.micDenied])

  const endCall = useCallback(() => {
    voiceRef.current?.stop()
    onCallRef.current = false
    setOnCall(false)
  }, [])

  const submit = useCallback(
    (event) => {
      event.preventDefault()
      const text = draft.trim()
      if (!text || thinking) return
      setDraft('')
      append('user', text)
      ask(text)
    },
    [append, ask, draft, thinking],
  )

  const statusLabel = thinking
    ? t.thinking
    : voiceState.speaking
      ? t.speaking
      : voiceState.listening
        ? t.listening
        : t.idle

  if (!open) {
    return (
      <button className="agent-launcher" onClick={() => setOpen(true)} aria-label={t.open} type="button">
        <Bot size={22} />
      </button>
    )
  }

  return (
    <section className="agent-panel" aria-label={t.title}>
      <header className="agent-head">
        <div>
          <strong>{t.title}</strong>
          <span className={`agent-status ${onCall ? 'connected' : ''} ${thinking ? 'connecting' : ''}`}>
            {statusLabel}
          </span>
        </div>
        <button className="agent-icon-btn" onClick={() => setOpen(false)} aria-label={t.close} type="button">
          <X size={16} />
        </button>
      </header>

      <div className="agent-log" ref={logRef}>
        {transcript.length === 0 && <p className="agent-empty">{t.empty}</p>}
        {transcript.map((entry, index) => (
          <div key={index} className={`agent-bubble ${entry.role}`}>
            {entry.text}
          </div>
        ))}
      </div>

      {error && <p className="agent-error">{error}</p>}

      <div className="agent-controls">
        {onCall ? (
          <>
            <button className="agent-btn danger" onClick={endCall} type="button">
              <PhoneOff size={16} /> {t.endCall}
            </button>
            <span className="agent-mic-state">
              {voiceState.listening ? <Mic size={16} /> : <MicOff size={16} />}
              {voiceState.listening ? t.listening : t.muted}
            </span>
          </>
        ) : (
          <button className="agent-btn primary" onClick={startCall} type="button">
            <Phone size={16} /> {t.call}
          </button>
        )}
      </div>

      <form className="agent-composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
        />
        <button className="agent-icon-btn" type="submit" aria-label={t.send} disabled={!draft.trim() || thinking}>
          <Send size={16} />
        </button>
      </form>
    </section>
  )
}
