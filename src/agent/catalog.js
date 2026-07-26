/**
 * Single source of truth for the agent's registered commands. `createAgentCommands`
 * in ./commands.js implements exactly these names; a mismatch is reported to the
 * console at startup.
 */
export const COMMAND_GROUPS = [
  {
    id: 'items',
    ar: 'الأصناف',
    en: 'Items',
    commands: [
      {
        name: 'get_summary',
        params: [],
        ar: 'ملخص الدفعة الحالية: عدد الأصناف، الكميات، الصفوف المحتاجة مراجعة، ونسبة الاكتمال.',
        en: 'Summary of the active batch: item count, units, rows needing review, completion.',
        sampleAr: 'إيه ملخص الدفعة دي؟',
        sampleEn: 'Give me a summary of this batch.',
      },
      {
        name: 'list_items',
        params: [
          { name: 'needs_review_only', type: 'boolean' },
          { name: 'limit', type: 'number' },
        ],
        ar: 'عرض صفوف الدفعة، مع إمكانية قصرها على الصفوف المحتاجة مراجعة.',
        en: 'List the batch rows, optionally only the ones flagged for review.',
        sampleAr: 'وريني الأصناف اللي محتاجة مراجعة.',
        sampleEn: 'Show me the items that need review.',
      },
      {
        name: 'find_item',
        params: [{ name: 'query', type: 'string', required: true }],
        ar: 'البحث عن صنف برقم الصف أو رمز SKU أو الاسم.',
        en: 'Look up an item by row number, SKU, or name.',
        sampleAr: 'دوّر على صنف السكر.',
        sampleEn: 'Find the sugar item.',
      },
      {
        name: 'update_item',
        params: [
          { name: 'query', type: 'string', required: true },
          { name: 'field', type: 'string', required: true },
          { name: 'value', type: 'string', required: true },
        ],
        ar: 'تعديل حقل واحد: الاسم، SKU، الكمية، الوحدة، الحالة، الملاحظات، أو علامة المراجعة.',
        en: 'Edit one field: itemName, sku, quantity, unit, condition, status, notes, needsReview.',
        sampleAr: 'غيّر كمية الصف الثالث لـ 12.',
        sampleEn: 'Change row 3 quantity to 12.',
      },
      {
        name: 'add_item',
        params: [
          { name: 'item_name', type: 'string', required: true },
          { name: 'quantity', type: 'number' },
          { name: 'unit', type: 'string' },
          { name: 'sku', type: 'string' },
          { name: 'notes', type: 'string' },
        ],
        ar: 'إضافة صنف جديد إلى الدفعة.',
        en: 'Append a new item to the batch.',
        sampleAr: 'ضيف 5 كراتين مياه.',
        sampleEn: 'Add 5 cartons of water.',
      },
      {
        name: 'delete_item',
        params: [{ name: 'query', type: 'string', required: true }],
        ar: 'حذف صنف من الدفعة.',
        en: 'Remove an item from the batch.',
        sampleAr: 'احذف آخر صنف.',
        sampleEn: 'Delete the last item.',
      },
    ],
  },
  {
    id: 'batches',
    ar: 'الدفعات والاستخراج',
    en: 'Batches & extraction',
    commands: [
      {
        name: 'run_extraction',
        params: [],
        ar: 'تشغيل الاستخراج على الصور المرفوعة.',
        en: 'Run extraction on the uploaded images.',
        sampleAr: 'ابدأ استخراج الصور.',
        sampleEn: 'Start the extraction.',
      },
      {
        name: 'export_data',
        params: [{ name: 'format', type: 'csv | xlsx | pdf', required: true }],
        ar: 'تصدير الدفعة كملف CSV أو XLSX، أو فتح نافذة الطباعة لـ PDF.',
        en: 'Export the batch as CSV or XLSX, or open the print dialog for PDF.',
        sampleAr: 'صدّر الجرد Excel.',
        sampleEn: 'Export this to Excel.',
      },
      {
        name: 'create_batch',
        params: [],
        ar: 'بدء دفعة جديدة فارغة.',
        en: 'Start a new empty batch.',
        sampleAr: 'افتح دفعة جديدة.',
        sampleEn: 'Start a new batch.',
      },
      {
        name: 'save_batch',
        params: [{ name: 'status', type: 'Draft | Pending | Verified | Synced' }],
        ar: 'حفظ الدفعة الحالية بحالة محددة.',
        en: 'Save the active batch with a status.',
        sampleAr: 'احفظ الدفعة كمُتحقق منها.',
        sampleEn: 'Save this batch as verified.',
      },
      {
        name: 'list_batches',
        params: [],
        ar: 'عرض الدفعات المحفوظة محلياً.',
        en: 'List the locally saved batches.',
        sampleAr: 'إيه الدفعات المحفوظة؟',
        sampleEn: 'What batches do I have saved?',
      },
      {
        name: 'load_batch',
        params: [{ name: 'query', type: 'string', required: true }],
        ar: 'تحميل دفعة محفوظة بالاسم أو المعرّف.',
        en: 'Load a saved batch by title or id.',
        sampleAr: 'حمّل دفعة أمس.',
        sampleEn: 'Load yesterday’s batch.',
      },
    ],
  },
  {
    id: 'workspace',
    ar: 'الواجهة',
    en: 'Workspace',
    commands: [
      {
        name: 'set_language',
        params: [{ name: 'language', type: 'ar | en', required: true }],
        ar: 'تبديل لغة الواجهة واتجاهها.',
        en: 'Switch the UI language and direction.',
        sampleAr: 'حوّل الواجهة للإنجليزي.',
        sampleEn: 'Switch the interface to Arabic.',
      },
      {
        name: 'set_model',
        params: [{ name: 'model', type: 'string', required: true }],
        ar: 'اختيار نموذج الاستخراج المستخدم.',
        en: 'Choose the extraction model.',
        sampleAr: 'استخدم نموذج Sonnet.',
        sampleEn: 'Use the Sonnet model.',
      },
      {
        name: 'open_panel',
        params: [{ name: 'panel', type: 'history | settings | close', required: true }],
        ar: 'فتح أو إغلاق سجل الدفعات أو الإعدادات.',
        en: 'Open or close the history drawer or settings.',
        sampleAr: 'افتح الإعدادات.',
        sampleEn: 'Open settings.',
      },
    ],
  },
]

export const COMMAND_NAMES = COMMAND_GROUPS.flatMap((group) => group.commands.map((command) => command.name))
