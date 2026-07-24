# Stockly AI

Stockly AI is a bilingual inventory digitization workspace for Arabic and English teams. It lets users upload inventory images, review OCR-style extraction results, export the data to CSV/XLSX, and sync batches directly into Google Sheets after signing in with Google.

## What’s included

- Responsive RTL/LTR dashboard with Arabic and English UI switching
- OCR-style batch extraction workflow for inventory sheets
- Editable review table for correcting extracted rows
- CSV/XLSX export and print-friendly PDF workflow
- Google Sign-In based Google Sheets selection and sync flow

## Run locally

1. Install dependencies:
   npm install
2. Start the Vite frontend:
   npm run dev
3. Start the secure OCR proxy:
   ANTHROPIC_API_KEY=your_key node server.js

The frontend expects the OCR proxy at /api/extract and will use it instead of calling Anthropic directly from the browser.

## Environment variables

- ANTHROPIC_API_KEY: server-side Anthropic key used by the proxy
