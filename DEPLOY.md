# Deploying Stockly so teammates can use it

The site is two halves:

| Half | Where it runs | Status |
| --- | --- | --- |
| The page (UI, review table, export) | GitHub Pages, already live | ✅ working |
| The API (OCR extraction, assistant, speech) | needs a Node host | ⬜ deploy below |

GitHub Pages serves static files only — it answers every `POST /api/*` with **405**. That
is why the assistant reports a failure there. The page needs to call an API server hosted
somewhere that runs Node.

## Step 1 — deploy the API (about 5 minutes, once)

1. Go to https://dashboard.render.com/blueprints and sign in with GitHub.
2. **New Blueprint Instance** → pick the `Stockly-Ai` repository. Render reads
   [render.yaml](render.yaml) and configures everything itself.
3. It will prompt for two secrets. Paste your **current** keys:
   - `ANTHROPIC_API_KEY`
   - `ELEVENLABS_API_KEY`
4. **Apply**. Wait for the service to go live and copy its URL, e.g.
   `https://stockly-api.onrender.com`.
5. Confirm it works — open `https://<your-url>/api/health` in a browser. You want:

   ```json
   {"ok":true}
   ```

If that URL does not return `{"ok":true}`, stop here and fix the service. Nothing on the
page can work until it does.

## Step 2 — point the page at the API

```
VITE_API_BASE=https://<your-url> node build-standalone.mjs
git add index.html && git commit -m "Point the deployed page at the API" && git push
```

GitHub Pages redeploys in about a minute. Share the Pages URL with your teammates —
`https://kingomar2013.github.io/Stockly-Ai/`.

## Notes

- **Free tier sleeps.** Render's free plan spins the service down after ~15 minutes idle,
  so the first request after a quiet period takes 30–60 seconds while it wakes. Everything
  after that is fast. A paid plan removes the delay.
- **Adding another origin** (a custom domain, a preview deploy): add it to
  `ALLOWED_ORIGIN` in the Render dashboard as a comma-separated list, or the browser will
  block the request.
- **Microphone needs HTTPS.** Both GitHub Pages and Render are HTTPS, so voice works.
- **Keys live in Render's environment**, never in the repository. Rotate them in the
  provider consoles and update them in Render → Environment; no code change or rebuild is
  needed.
