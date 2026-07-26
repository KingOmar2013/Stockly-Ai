import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { extractInventory, describeExtractionError } from './extraction'
import StocklyAgent from './agent/StocklyAgent'
import CommandsPanel from './agent/CommandsPanel'
import {
  AlertTriangle,
  ArrowDownToLine,
  Camera,
  CheckCircle2,
  Copy,
  FileImage,
  FileSpreadsheet,
  History,
  LayoutGrid,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import './App.css'

const STORAGE_KEY = 'smart-inventory-digitizer-batches'
const SETTINGS_KEY = 'smart-inventory-digitizer-settings'
const GOOGLE_SHEETS_SCOPE = 'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly'

const MODEL_OPTIONS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

const defaultSettings = {
  model: 'claude-opus-4-8',
}

const buildSampleRows = (language = 'ar') => {
  if (language === 'en') {
    return [
      {
        rowIndex: 1,
        itemName: '1.5L Water Bottles',
        sku: 'SKU-1001',
        quantity: 48,
        unit: 'Carton',
        condition: 'Good',
        status: 'Verified',
        notes: 'Entered from the first page',
        confidence: 0.94,
        needsReview: false,
      },
      {
        rowIndex: 2,
        itemName: 'Orange Juice Cans',
        sku: 'SKU-1048',
        quantity: 18,
        unit: 'Piece',
        condition: 'Full',
        status: 'Needs Review',
        notes: 'Quantity field needs printed confirmation',
        confidence: 0.72,
        needsReview: true,
      },
      {
        rowIndex: 3,
        itemName: 'Tuna Cans',
        sku: 'SKU-1994',
        quantity: 22,
        unit: 'Can',
        condition: 'Good',
        status: 'Verified',
        notes: 'Found in the left cabinet',
        confidence: 0.9,
        needsReview: false,
      },
    ]
  }

  return [
    {
      rowIndex: 1,
      itemName: 'زجاجات ماء ١٫٥ لتر',
      sku: 'SKU-1001',
      quantity: 48,
      unit: 'كرتونة',
      condition: 'جيد',
      status: 'تم التحقق',
      notes: 'تم إدخالها من الصفحة الأولى',
      confidence: 0.94,
      needsReview: false,
    },
    {
      rowIndex: 2,
      itemName: 'علب عصير برتقال',
      sku: 'SKU-1048',
      quantity: 18,
      unit: 'قطعة',
      condition: 'ممتلئ',
      status: 'قيد المراجعة',
      notes: 'حقل الكمية يحتاج تأكيد طباعي',
      confidence: 0.72,
      needsReview: true,
    },
    {
      rowIndex: 3,
      itemName: 'معلبات تونة',
      sku: 'SKU-1994',
      quantity: 22,
      unit: 'علبة',
      condition: 'جيد',
      status: 'تم التحقق',
      notes: 'موجودة في الخزانة اليسرى',
      confidence: 0.9,
      needsReview: false,
    },
  ]
}

const readStorage = (storageKey, fallback) => {
  if (typeof window === 'undefined') return fallback

  try {
    const saved = window.localStorage.getItem(storageKey)
    return saved ? JSON.parse(saved) : fallback
  } catch {
    return fallback
  }
}

const createBatchSeed = (batchTitle = 'Today Batch', language = 'ar') => ({
  id: crypto.randomUUID(),
  title: batchTitle,
  createdAt: new Date().toISOString(),
  status: 'Draft',
  documentMeta: {
    date: new Date().toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US'),
    location: language === 'ar' ? 'المخزن الرئيسي' : 'Main Warehouse',
    counterName: language === 'ar' ? 'مدخل اللوجستيك' : 'Logistics Intake',
    columnHeaders: language === 'ar' ? ['اسم المادة', 'المخزون', 'الوحدة', 'الحالة'] : ['Item Name', 'Stock', 'Unit', 'Condition'],
    pageCount: 1,
    legibilityStatus: language === 'ar' ? 'طباعة واضحة' : 'Clear print',
  },
  rows: buildSampleRows(language),
  unparsedRegions: [],
})

function App() {
  const [language, setLanguage] = useState('ar')
  const [batches, setBatches] = useState(() => readStorage(STORAGE_KEY, [createBatchSeed('Today Batch', 'ar')]))
  const [settings, setSettings] = useState(() => {
    const merged = { ...defaultSettings, ...readStorage(SETTINGS_KEY, {}) }
    if (!MODEL_OPTIONS.some((option) => option.id === merged.model)) {
      merged.model = defaultSettings.model
    }
    return merged
  })
  const anthropicApiKey = import.meta.env.VITE_ANTHROPIC_API_KEY || ''
  const [activeBatch, setActiveBatch] = useState(() => batches[0] ?? createBatchSeed('Today Batch', language))
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [brightness, setBrightness] = useState(110)
  const [contrast, setContrast] = useState(110)
  const [rotation, setRotation] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState(null) // { ok: boolean, text: string }

  

  const uiCopy = {
    ar: {
      eyebrow: 'تطبيق الجرد الذكي',
      title: 'Stockly AI',
      subtitle: 'منصة الجرد الذكي',
      languageLabel: 'EN',
      history: 'السجل',
      settings: 'الإعدادات',
      agentCommands: 'أوامر المساعد',
      newBatch: 'دفعة جديدة',
      importDoc: 'استيراد المستند',
      captureTitle: 'التقاط وجمع أوراق الجرد',
      runExtraction: 'تشغيل استخراج بصري',
      runningExtraction: 'جارٍ الاستخراج…',
      dragOrChoose: 'اسحب الملفات أو اختر صور الجرد',
      previewPlaceholder: 'معاينة الصور ستظهر هنا',
      brightness: 'السطوع',
      contrast: 'التباين',
      rotation: 'الدوران',
      date: 'التاريخ',
      location: 'الموقع',
      counterName: 'اسم العداد',
      pageCount: 'عدد الصفحات',
      modelIdentity: 'هوية النموذج',
      aiVision: 'AI Vision Extraction Engine',
      reviewTable: 'مراجعة ورقة الجرد',
      tableTitle: 'جدول التعديلات والحفظ',
      csv: 'CSV',
      excel: 'Excel',
      pdf: 'PDF',
      settingsPanel: 'لوحة الإعدادات',
      settingsTitle: 'مزامنة Google Sheets',
      saveBatch: 'حفظ الدفعة',
      anthropicKey: 'Anthropic API Key',
      visionModel: 'نموذج الرؤية',
      spreadsheetId: 'اختر ورقة العمل',
      webhookUrl: 'Webhook URL',
      googleSheets: 'Google Sheets',
      appendBatch: 'إلحاق دفعة إلى ورقة العمل',
      openModal: 'فتح المودال',
      signInGoogle: 'تسجيل الدخول عبر Google',
      refreshSheets: 'تحديث اللوائح',
      createSheet: 'إنشاء ورقة جديدة',
      batchStatus: 'حالة الدفعة',
      syncCopy: 'استخدم معرف ورقة أو رابط Webhook ليتم رفع الدفعة إلى Google Sheets مباشرة.',
      close: 'إغلاق',
      sheetIdPlaceholder: 'أدخل معرف الورقة',
      syncNow: 'مزامنة الآن',
      syncingNow: 'جارٍ المزامنة…',
      modalSettings: 'الإعدادات',
      modalSheetSync: 'مزامنة Google Sheets',
      historyTitle: 'دفعات الجرد',
      localLog: 'السجل المحلي',
      statTotalItems: 'إجمالي العناصر',
      statTotalUnits: 'إجمالي الوحدات',
      statReviewFlags: 'علامات المراجعة',
      statCompletion: 'نسبة الإكمال',
      unparsedTitle: 'مناطق تعذّر فكّها',
      sheetName: 'الجرد',
      apiKeySet: 'مفتاح API مُهيّأ من متغيرات البيئة',
      apiKeyMissing: 'مفتاح API غير مُهيّأ — أضف VITE_ANTHROPIC_API_KEY',
      legibility: 'وضوح الخط',
      uiLanguage: 'لغة الواجهة',
      reviewPrompt: 'يتم تمرير نص موجه بصري عربي صارم إلى النموذج، مع إخراج JSON متكامل يحتوي على بيانات المستند، الصفوف، وخلايا غير قابلة للفك.',
      connecting: 'جارٍ الاتصال…',
      noSpreadsheets: 'لم يتم العثور على لوائح',
      signInToLoad: 'سجّل الدخول لتحميل اللوائح',
      connectedAs: 'متصل باسم',
      googleConnected: 'تم الاتصال بحساب Google.',
      googleLoginFailed: 'فشل تسجيل الدخول إلى Google.',
      googleClientIdMissing: 'معرّف العميل الخاص بـ Google غير مُهيّأ.',
      sheetRequired: 'سجّل الدخول إلى Google واختر ورقة عمل أولاً.',
      syncSuccess: 'تمت المزامنة بنجاح.',
      syncFailed: 'فشل التزامن.',
      statusDraft: 'مسودة',
      statusPending: 'قيد الانتظار',
      statusVerified: 'تم التحقق',
      statusSynced: 'تمت المزامنة',
      columns: {
        number: 'م',
        itemName: 'اسم المادة',
        sku: 'SKU',
        quantity: 'الكمية',
        unit: 'الوحدة',
        condition: 'الحالة',
        generalStatus: 'الحالة العامة',
        notes: 'ملاحظات',
        confidence: 'الثقة',
        actions: 'إجراءات',
      },
      conditions: {
        full: 'ممتلئ',
        good: 'جيد',
        damaged: 'تالف',
      },
      statusNew: 'جديد',
      itemNew: 'عنصر جديد',
    },
    en: {
      eyebrow: 'Smart Inventory Platform',
      title: 'Stockly AI',
      subtitle: 'Inventory Digitizer',
      languageLabel: 'AR',
      history: 'History',
      settings: 'Settings',
      agentCommands: 'Assistant Commands',
      newBatch: 'New Batch',
      importDoc: 'Document Import',
      captureTitle: 'Capture and Collect Inventory Sheets',
      runExtraction: 'Run Visual Extraction',
      runningExtraction: 'Extracting…',
      dragOrChoose: 'Drag files or choose inventory images',
      previewPlaceholder: 'Image preview will appear here',
      brightness: 'Brightness',
      contrast: 'Contrast',
      rotation: 'Rotation',
      date: 'Date',
      location: 'Location',
      counterName: 'Counter Name',
      pageCount: 'Page Count',
      modelIdentity: 'Model Identity',
      aiVision: 'AI Vision Extraction Engine',
      reviewTable: 'Inventory Review',
      tableTitle: 'Edit and Save Sheet',
      csv: 'CSV',
      excel: 'Excel',
      pdf: 'PDF',
      settingsPanel: 'Settings Panel',
      settingsTitle: 'Google Sheets Sync',
      saveBatch: 'Save Batch',
      anthropicKey: 'Anthropic API Key',
      visionModel: 'Vision Model',
      spreadsheetId: 'Choose Spreadsheet',
      webhookUrl: 'Webhook URL',
      googleSheets: 'Google Sheets',
      appendBatch: 'Append Batch to Worksheet',
      openModal: 'Open Modal',
      signInGoogle: 'Sign in with Google',
      refreshSheets: 'Refresh Sheets',
      createSheet: 'Create New Sheet',
      batchStatus: 'Batch Status',
      syncCopy: 'Use a sheet ID or webhook URL to push the batch directly to Google Sheets.',
      close: 'Close',
      sheetIdPlaceholder: 'Enter sheet ID',
      syncNow: 'Sync Now',
      syncingNow: 'Syncing…',
      modalSettings: 'Settings',
      modalSheetSync: 'Google Sheets Sync',
      historyTitle: 'Inventory Batches',
      localLog: 'Local Record',
      statTotalItems: 'Total Items',
      statTotalUnits: 'Total Units',
      statReviewFlags: 'Review Flags',
      statCompletion: 'Completion',
      unparsedTitle: 'Unreadable Regions',
      sheetName: 'Inventory',
      apiKeySet: 'API key configured from environment',
      apiKeyMissing: 'API key missing — set VITE_ANTHROPIC_API_KEY',
      legibility: 'Legibility',
      uiLanguage: 'Interface Language',
      reviewPrompt: 'A strict Arabic visual prompt is passed to the model, with a structured JSON response containing document metadata, rows, and unreadable cells.',
      connecting: 'Connecting…',
      noSpreadsheets: 'No spreadsheets found',
      signInToLoad: 'Sign in to load spreadsheets',
      connectedAs: 'Connected as',
      googleConnected: 'Google account connected.',
      googleLoginFailed: 'Google login failed.',
      googleClientIdMissing: 'Google client ID is not configured.',
      sheetRequired: 'Sign in with Google and choose a spreadsheet first.',
      syncSuccess: 'Synced successfully.',
      syncFailed: 'Sync failed.',
      statusDraft: 'Draft',
      statusPending: 'Pending',
      statusVerified: 'Verified',
      statusSynced: 'Synced',
      columns: {
        number: '#',
        itemName: 'Item Name',
        sku: 'SKU',
        quantity: 'Quantity',
        unit: 'Unit',
        condition: 'Condition',
        generalStatus: 'Status',
        notes: 'Notes',
        confidence: 'Confidence',
        actions: 'Actions',
      },
      conditions: {
        full: 'Full',
        good: 'Good',
        damaged: 'Damaged',
      },
      statusNew: 'New',
      itemNew: 'New Item',
    },
  }

  const t = uiCopy[language]

  const getStatusLabel = (status) => {
    switch (status) {
      case 'Draft':
        return t.statusDraft
      case 'Pending':
        return t.statusPending
      case 'Verified':
        return t.statusVerified
      case 'Synced':
        return t.statusSynced
      default:
        return status
    }
  }

  const stats = useMemo(() => {
    const totalItems = activeBatch.rows.length
    const totalUnits = activeBatch.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
    const reviewCount = activeBatch.rows.filter((row) => row.needsReview).length
    const completion = Math.round(((totalItems - reviewCount) / Math.max(totalItems, 1)) * 100)

    return { totalItems, totalUnits, reviewCount, completion }
  }, [activeBatch])

  const handleFiles = (incomingFiles) => {
    const imageFiles = Array.from(incomingFiles).filter((file) => file.type.startsWith('image/'))
    setUploadedFiles(imageFiles)
    setPreviews(imageFiles.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })))
  }

  const onDropFiles = (event) => {
    event.preventDefault()
    setIsDraggingFiles(false)
    handleFiles(event.dataTransfer.files)
  }

  const createNewBatch = () => {
    const newBatch = createBatchSeed(
      language === 'ar' ? `دفعة ${new Date().toLocaleTimeString('ar-SA')}` : `Batch ${new Date().toLocaleTimeString('en-US')}`,
      language,
    )
    setActiveBatch(newBatch)
    setBatches((current) => [newBatch, ...current])
  }

  const runExtraction = async () => {
    if (extracting) return { ok: false, error: 'Extraction already in progress.' }
    setExtractError('')
    setExtracting(true)
    try {
      const result = await extractInventory({
        apiKey: anthropicApiKey,
        model: settings.model,
        files: uploadedFiles,
        adjustments: {
          brightness: Number(brightness),
          contrast: Number(contrast),
          rotation: Number(rotation),
        },
      })

      const nextBatch = {
        ...activeBatch,
        status: 'Pending',
        documentMeta: {
          date: result.documentMeta.date || activeBatch.documentMeta.date,
          location: result.documentMeta.location || activeBatch.documentMeta.location,
          counterName: result.documentMeta.counterName || activeBatch.documentMeta.counterName,
          columnHeaders: result.documentMeta.columnHeaders.length
            ? result.documentMeta.columnHeaders
            : activeBatch.documentMeta.columnHeaders,
          pageCount: result.documentMeta.pageCount || uploadedFiles.length,
          legibilityStatus:
            result.documentMeta.legibilityStatus || (language === 'ar' ? 'غير محدد' : 'Unknown'),
        },
        rows: result.rows.map((row, index) => ({ ...row, rowIndex: index + 1 })),
        unparsedRegions: result.unparsedRegions ?? [],
      }

      setActiveBatch(nextBatch)
      setBatches((current) => [nextBatch, ...current.filter((batch) => batch.id !== nextBatch.id)])

      return {
        ok: true,
        rowCount: nextBatch.rows.length,
        reviewCount: nextBatch.rows.filter((row) => row.needsReview).length,
        unparsedRegions: nextBatch.unparsedRegions,
      }
    } catch (error) {
      const message = describeExtractionError(error)
      setExtractError(message)
      return { ok: false, error: message }
    } finally {
      setExtracting(false)
    }
  }

  const updateRow = (index, field, value) => {
    setActiveBatch((current) => ({
      ...current,
      rows: current.rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    }))
  }

  const insertRow = (index) => {
    const newRow = {
      rowIndex: activeBatch.rows.length + 1,
      itemName: t.itemNew,
      sku: `SKU-${Date.now()}`,
      quantity: 1,
      unit: language === 'ar' ? 'قطعة' : 'piece',
      condition: language === 'ar' ? 'جيد' : 'Good',
      status: t.statusNew,
      notes: '',
      confidence: 0.81,
      needsReview: false,
    }

    const nextRows = [...activeBatch.rows]
    nextRows.splice(index + 1, 0, newRow)
    setActiveBatch((current) => ({
      ...current,
      rows: nextRows.map((row, rowIndex) => ({ ...row, rowIndex: rowIndex + 1 })),
    }))
  }

  const cloneRow = (index) => {
    const row = activeBatch.rows[index]
    const nextRows = [...activeBatch.rows]
    nextRows.splice(index + 1, 0, { ...row, rowIndex: nextRows.length + 1, sku: `${row.sku}-copy` })
    setActiveBatch((current) => ({
      ...current,
      rows: nextRows.map((item, rowIndex) => ({ ...item, rowIndex: rowIndex + 1 })),
    }))
  }

  const deleteRow = (index) => {
    const nextRows = activeBatch.rows.filter((_, rowIndex) => rowIndex !== index)
    setActiveBatch((current) => ({
      ...current,
      rows: nextRows.map((row, rowIndex) => ({ ...row, rowIndex: rowIndex + 1 })),
    }))
  }

  const saveCurrentBatch = (status = 'Draft') => {
    const payload = {
      ...activeBatch,
      status,
      title:
        language === 'ar'
          ? `دفعة ${new Date().toLocaleDateString('ar-SA')}`
          : `Batch ${new Date().toLocaleDateString('en-US')}`,
      createdAt: new Date().toISOString(),
    }

    setBatches((current) => [payload, ...current.filter((batch) => batch.id !== payload.id)])
    setActiveBatch(payload)
  }

  const loadBatch = (batchId) => {
    const batch = batches.find((item) => item.id === batchId)
    if (batch) {
      setActiveBatch(batch)
      setDrawerOpen(false)
    }
  }

  const exportWorkbook = (type) => {
    const sheet = XLSX.utils.json_to_sheet(
      activeBatch.rows.map((row) => ({
        [t.columns.itemName]: row.itemName,
        SKU: row.sku,
        [t.columns.quantity]: row.quantity,
        [t.columns.unit]: row.unit,
        [t.columns.condition]: row.condition,
        [t.columns.generalStatus]: row.status,
        [t.columns.notes]: row.notes,
        [t.columns.confidence]: row.confidence,
        [language === 'ar' ? 'محتاج مراجعة' : 'Needs Review']: row.needsReview ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No'),
      })),
    )

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, t.sheetName)

    if (type === 'xlsx') {
      XLSX.writeFile(workbook, 'smart-inventory-digitizer.xlsx')
      saveCurrentBatch('Verified')
    } else if (type === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(sheet)
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'smart-inventory-digitizer.csv'
      link.click()
      URL.revokeObjectURL(link.href)
      saveCurrentBatch('Verified')
    }
  }

  const exportPdf = () => {
    saveCurrentBatch('Pending')
    window.print()
  }

  const agentPatchRow = (index, patch) => {
    setActiveBatch((current) => ({
      ...current,
      rows: current.rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }))
  }

  const agentAddRow = (partial) => {
    const row = {
      rowIndex: activeBatch.rows.length + 1,
      itemName: t.itemNew,
      sku: `SKU-${Date.now()}`,
      quantity: 1,
      unit: language === 'ar' ? 'قطعة' : 'piece',
      condition: language === 'ar' ? 'جيد' : 'Good',
      status: t.statusNew,
      notes: '',
      confidence: 1,
      needsReview: false,
      ...partial,
    }

    setActiveBatch((current) => ({
      ...current,
      rows: [...current.rows, row].map((item, rowIndex) => ({ ...item, rowIndex: rowIndex + 1 })),
    }))

    return row
  }

  const agentApiRef = useRef(null)
  agentApiRef.current = {
    getState: () => ({
      language,
      activeBatch,
      batches,
      stats,
      settings,
      uploadedFiles,
      extracting,
      modelOptions: MODEL_OPTIONS,
    }),
    setLanguage,
    setDrawerOpen,
    setShowSettings,
    setModel: (model) => setSettings((current) => ({ ...current, model })),
    createNewBatch,
    saveCurrentBatch,
    loadBatch,
    runExtraction,
    exportWorkbook,
    exportPdf,
    patchRow: agentPatchRow,
    addRow: agentAddRow,
    deleteRow,
  }

  

  

  return (
    <div className="app-shell" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div>
            <p className="eyebrow">{t.localLog}</p>
            <h3>{t.historyTitle}</h3>
          </div>
          <button className="ghost-btn" onClick={() => setDrawerOpen(false)}>
            {t.close}
          </button>
        </div>

        <div className="history-list">
          {batches.map((batch) => (
            <button className="history-card" key={batch.id} onClick={() => loadBatch(batch.id)}>
              <span>{batch.title}</span>
              <small>{getStatusLabel(batch.status)}</small>
            </button>
          ))}
        </div>
      </aside>

      <div className="page-frame">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p className="eyebrow">{t.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-btn" onClick={() => setLanguage((current) => (current === 'ar' ? 'en' : 'ar'))}>
              {t.languageLabel}
            </button>
            <button className="ghost-btn" onClick={() => setDrawerOpen(true)}>
              <History size={16} />
              {t.history}
            </button>
            <button className="ghost-btn" onClick={() => setShowCommands(true)}>
              <Terminal size={16} />
              {t.agentCommands}
            </button>
            <button className="ghost-btn" onClick={() => setShowSettings(true)}>
              <Settings size={16} />
              {t.settings}
            </button>
            <button className="ghost-btn" onClick={createNewBatch}>
              <Sparkles size={16} />
              {t.newBatch}
            </button>
          </div>
        </header>

        <section className="stats-grid">
          <article className="stat-card">
            <span>{t.statTotalItems}</span>
            <strong>{stats.totalItems}</strong>
          </article>
          <article className="stat-card">
            <span>{t.statTotalUnits}</span>
            <strong>{stats.totalUnits}</strong>
          </article>
          <article className="stat-card">
            <span>{t.statReviewFlags}</span>
            <strong>{stats.reviewCount}</strong>
          </article>
          <article className="stat-card">
            <span>{t.statCompletion}</span>
            <strong>{stats.completion}%</strong>
          </article>
        </section>

        <main className="dashboard-grid">
          <section className="panel capture-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{t.importDoc}</p>
                <h2>{t.captureTitle}</h2>
              </div>
              <button className="primary-btn" onClick={runExtraction} disabled={extracting}>
                <Sparkles size={16} />
                {extracting ? t.runningExtraction : t.runExtraction}
              </button>
            </div>

            {extractError && (
              <div className="extract-error">
                <AlertTriangle size={16} />
                <span>{extractError}</span>
              </div>
            )}

            <label
              className={`dropzone ${isDraggingFiles ? 'drag-active' : ''}`}
              htmlFor="upload-documents"
              onDragOver={(event) => {
                event.preventDefault()
                setIsDraggingFiles(true)
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={onDropFiles}
            >
              <UploadCloud size={20} />
              <span>{t.dragOrChoose}</span>
              <input
                id="upload-documents"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => handleFiles(event.target.files)}
              />
            </label>

            <div className="image-preview-grid">
              {previews.length ? (
                previews.map((preview) => (
                  <div className="preview-tile" key={preview.url}>
                    <img
                      src={preview.url}
                      alt={preview.name}
                      style={{
                        filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                        transform: `rotate(${rotation}deg)`,
                      }}
                    />
                  </div>
                ))
              ) : (
                <div className="empty-preview">
                  <Camera size={18} />
                  {t.previewPlaceholder}
                </div>
              )}
            </div>

            <div className="slider-group">
              <label>
                {t.brightness}
                <input type="range" min="60" max="160" value={brightness} onChange={(e) => setBrightness(e.target.value)} />
              </label>
              <label>
                {t.contrast}
                <input type="range" min="60" max="160" value={contrast} onChange={(e) => setContrast(e.target.value)} />
              </label>
              <label>
                {t.rotation}
                <input type="range" min="-10" max="10" value={rotation} onChange={(e) => setRotation(e.target.value)} />
              </label>
            </div>

            <div className="meta-card">
              <div>
                <span>{t.date}</span>
                <strong>{activeBatch.documentMeta.date}</strong>
              </div>
              <div>
                <span>{t.location}</span>
                <strong>{activeBatch.documentMeta.location}</strong>
              </div>
              <div>
                <span>{t.counterName}</span>
                <strong>{activeBatch.documentMeta.counterName}</strong>
              </div>
              <div>
                <span>{t.pageCount}</span>
                <strong>{activeBatch.documentMeta.pageCount}</strong>
              </div>
              <div>
                <span>{t.legibility}</span>
                <strong>{activeBatch.documentMeta.legibilityStatus}</strong>
              </div>
            </div>

            {activeBatch.unparsedRegions?.length > 0 && (
              <div className="review-notes">
                <p className="eyebrow">
                  <AlertTriangle size={14} /> {t.unparsedTitle}
                </p>
                <ul>
                  {activeBatch.unparsedRegions.map((region) => (
                    <li key={region}>{region}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

        </main>

        <section className="panel table-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t.reviewTable}</p>
              <h2>{t.tableTitle}</h2>
            </div>
            <div className="table-actions">
              <button className="ghost-btn" onClick={() => exportWorkbook('csv')}>
                <ArrowDownToLine size={16} />
                {t.csv}
              </button>
              <button className="ghost-btn" onClick={() => exportWorkbook('xlsx')}>
                <FileSpreadsheet size={16} />
                {t.excel}
              </button>
              <button className="ghost-btn" onClick={exportPdf}>
                <FileImage size={16} />
                {t.pdf}
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.columns.number}</th>
                  <th>{t.columns.itemName}</th>
                  <th>{t.columns.sku}</th>
                  <th>{t.columns.quantity}</th>
                  <th>{t.columns.unit}</th>
                  <th>{t.columns.condition}</th>
                  <th>{t.columns.generalStatus}</th>
                  <th>{t.columns.notes}</th>
                  <th>{t.columns.confidence}</th>
                  <th>{t.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {activeBatch.rows.map((row, index) => (
                  <tr key={row.rowIndex} className={row.needsReview ? 'row-review' : ''}>
                    <td>{row.rowIndex}</td>
                    <td>
                      <input value={row.itemName} onChange={(e) => updateRow(index, 'itemName', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.sku} onChange={(e) => updateRow(index, 'sku', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" value={row.quantity} onChange={(e) => updateRow(index, 'quantity', Number(e.target.value))} />
                    </td>
                    <td>
                      <input value={row.unit} onChange={(e) => updateRow(index, 'unit', e.target.value)} />
                    </td>
                    <td>
                      <select value={row.condition} onChange={(e) => updateRow(index, 'condition', e.target.value)}>
                        <option>{t.conditions.full}</option>
                        <option>{t.conditions.good}</option>
                        <option>{t.conditions.damaged}</option>
                      </select>
                    </td>
                    <td>
                      <input value={row.status} onChange={(e) => updateRow(index, 'status', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.notes} onChange={(e) => updateRow(index, 'notes', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" min="0" max="1" step="0.01" value={row.confidence} onChange={(e) => updateRow(index, 'confidence', Number(e.target.value))} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => insertRow(index)}><Plus size={14} /></button>
                        <button onClick={() => cloneRow(index)}><Copy size={14} /></button>
                        <button onClick={() => deleteRow(index)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bottom-grid">
          <section className="panel settings-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{t.settingsPanel}</p>
                <h2>{t.settingsTitle}</h2>
              </div>
              <button className="primary-btn" onClick={() => saveCurrentBatch('Verified')}>
                <ShieldCheck size={16} />
                {t.saveBatch}
              </button>
            </div>
            <div className="settings-form">
              <label>
                {t.visionModel}
                <select
                  value={settings.model}
                  onChange={(e) => setSettings((current) => ({ ...current, model: e.target.value }))}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.uiLanguage}
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <div className={`sync-note ${anthropicApiKey ? 'ok' : 'error'}`}>
                {anthropicApiKey ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span>{anthropicApiKey ? t.apiKeySet : t.apiKeyMissing}</span>
              </div>
            </div>
          </section>
        </section>
      </div>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t.modalSettings}</h3>
              <button className="ghost-btn" onClick={() => setShowSettings(false)}>{t.close}</button>
            </div>
            <div className="settings-form compact">
              <label>
                {t.visionModel}
                <select
                  value={settings.model}
                  onChange={(e) => setSettings((current) => ({ ...current, model: e.target.value }))}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.uiLanguage}
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <div className={`sync-note ${anthropicApiKey ? 'ok' : 'error'}`}>
                {anthropicApiKey ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span>{anthropicApiKey ? t.apiKeySet : t.apiKeyMissing}</span>
              </div>
            </div>
            <p>{t.reviewPrompt}</p>
          </div>
        </div>
      )}

      {showCommands && <CommandsPanel language={language} onClose={() => setShowCommands(false)} />}

      <StocklyAgent apiRef={agentApiRef} language={language} />
    </div>
  )
}

export default App
