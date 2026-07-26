# Stockly Voice + Chat Assistant

Claude is the brain. ElevenLabs does speech only. There is no ElevenLabs agent, no
dashboard configuration, and no client tools to register — the command set lives in code.

```
mic ──> /api/agent/stt (Scribe) ──┐
                                  ├──> /api/agent/chat ──> Claude (tools from catalog.js)
keyboard ─────────────────────────┘          │
                                             ├─ tool_use ──> run in browser ──> tool_result ──> loop
                                             └─ text ──> /api/agent/tts ──> audio out
```

| File | Role |
| --- | --- |
| [catalog.js](src/agent/catalog.js) | The 15 commands: params, AR/EN descriptions, sample utterances. Single source of truth. |
| [schema.js](src/agent/schema.js) | Turns the catalog into Anthropic `tools` definitions. Imported by both the browser and the server. |
| [commands.js](src/agent/commands.js) | Executes each command against the live app via `apiRef`. Warns on any catalog/implementation drift. |
| [brain.js](src/agent/brain.js) | The tool-use loop: post history → run `tool_use` blocks locally → post `tool_result` → repeat. |
| [voice.js](src/agent/voice.js) | Mic capture, silence-segmented utterances, TTS playback, barge-in. |
| [StocklyAgent.jsx](src/agent/StocklyAgent.jsx) | Call + chat widget. |
| [CommandsPanel.jsx](src/agent/CommandsPanel.jsx) | The **Assistant Commands** dashboard button. |
| [server.js](server.js) | `/api/agent/chat`, `/api/agent/stt`, `/api/agent/tts`. Stateless — the browser holds the transcript. |
| [scripts/agent-prompt.txt](scripts/agent-prompt.txt) | System prompt, loaded by the server at startup. |

## Configuration

All keys are server-side; nothing sensitive reaches the browser.

```
ANTHROPIC_API_KEY=sk-ant-...        # the brain
AGENT_MODEL=claude-opus-5           # optional override
ELEVENLABS_API_KEY=sk_...           # speech in/out only
ELEVENLABS_VOICE_ID=nPczCjzI2devNBz1zQrb   # Brian (premade). Free plans can only use
                                    # premade voices via the API — library/professional
                                    # voices return 402 paid_plan_required.
ELEVENLABS_VOICE_ID_AR=             # optional per-language overrides; each falls
ELEVENLABS_VOICE_ID_EN=             # back to ELEVENLABS_VOICE_ID when empty
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
```

Run `npm run dev` and `npm run dev:server` together. Voice needs HTTPS or localhost for
microphone access.

## Model settings and why

| Setting | Value | Reason |
| --- | --- | --- |
| `model` | `claude-opus-5` | Best tool-use reliability; `AGENT_MODEL` can drop it to `claude-sonnet-5` for cost |
| `output_config.effort` | `low` | Voice latency. Adaptive thinking stays **on** — disabling it on Opus 5 can emit tool calls as plain text that never execute |
| `max_tokens` | 8192 | Thinking and reply share this budget |
| `fallbacks` | `"default"` | Opus 5 safety classifiers can decline a turn; this re-runs it on Anthropic's recommended fallback instead of failing |

## Commands

`get_summary` · `list_items` · `find_item` · `update_item` · `add_item` · `delete_item` ·
`run_extraction` · `export_data` · `create_batch` · `save_batch` · `list_batches` ·
`load_batch` · `set_language` · `set_model` · `open_panel`

`query` resolves a row by 1-based index → SKU → exact name → substring, so "delete row 3"
and "set السكر to 12" both work. Full parameter reference: the **Assistant Commands**
button in the app, or [catalog.js](src/agent/catalog.js).

Adding a command means editing two files: describe it in `catalog.js`, implement it in
`commands.js`. Claude picks it up on the next request — nothing to deploy or register.

## Voice loop details

- **Segmentation**: WebAudio RMS over 50 ms frames. Speech above 0.02, utterance closes
  after 900 ms of trailing silence, anything under 350 ms of speech is discarded.
- **Barge-in**: speech detected while a reply is playing cancels playback immediately.
- **STT**: one round trip per utterance (`scribe_v1`), not a realtime socket — simpler, and
  the latency lands inside the pause the user already made. The UI language is passed as
  `language_code`; without it Scribe misreads short Arabic clips as other scripts.
- **Tuning**: the thresholds are constants at the top of [voice.js](src/agent/voice.js).
  Raise `SPEECH_RMS` in a noisy warehouse; lower `SILENCE_MS` for snappier turn-taking.

## Deployment

GitHub Pages is a static host: it cannot run `server.js`, so every POST to `/api/*` there
returns **405**. The assistant and OCR extraction both need the API running somewhere that
executes Node.

1. Deploy `server.js` (Render, Railway, Fly, or a Vercel serverless function) with
   `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and
   `ALLOWED_ORIGIN=https://<user>.github.io` set in the host's environment.
2. Rebuild the static page pointing at it:

   ```
   VITE_API_BASE=https://your-api-host node build-standalone.mjs
   ```

3. Commit the regenerated `index.html` and push.

`GET /api/health` returns `{"ok":true}` — check that first to confirm the API host is up
before debugging the page. Locally `VITE_API_BASE` stays empty and the Vite dev proxy
forwards `/api` to port 3001, so nothing changes for development.
