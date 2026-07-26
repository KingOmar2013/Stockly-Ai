import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { COMMAND_GROUPS, COMMAND_NAMES } from './catalog.js'

const COPY = {
  ar: {
    title: 'أوامر المساعد',
    subtitle: (count) => `${count} أمراً يمكن للمساعد تنفيذها عبر الاتصال أو المحادثة`,
    search: 'ابحث في الأوامر…',
    empty: 'لا يوجد أمر مطابق.',
    example: 'مثال',
    noParams: 'بدون معطيات',
    close: 'إغلاق',
  },
  en: {
    title: 'Assistant commands',
    subtitle: (count) => `${count} commands the assistant can run over a call or chat`,
    search: 'Search commands…',
    empty: 'No matching command.',
    example: 'Say',
    noParams: 'no parameters',
    close: 'Close',
  },
}

export default function CommandsPanel({ language = 'en', onClose }) {
  const t = COPY[language] ?? COPY.en
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return COMMAND_GROUPS
    return COMMAND_GROUPS.map((group) => ({
      ...group,
      commands: group.commands.filter((command) =>
        [command.name, command.ar, command.en, command.sampleAr, command.sampleEn]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      ),
    })).filter((group) => group.commands.length)
  }, [query])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card commands-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{t.title}</h3>
            <p className="eyebrow">{t.subtitle(COMMAND_NAMES.length)}</p>
          </div>
          <button className="ghost-btn" onClick={onClose} aria-label={t.close} type="button">
            <X size={16} />
          </button>
        </div>

        <input
          className="commands-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search}
          aria-label={t.search}
        />

        <div className="commands-list">
          {groups.length === 0 && <p className="commands-empty">{t.empty}</p>}
          {groups.map((group) => (
            <section key={group.id}>
              <p className="commands-group">{language === 'ar' ? group.ar : group.en}</p>
              {group.commands.map((command) => (
                <article className="command-item" key={command.name}>
                  <header>
                    <code>{command.name}</code>
                    <span className="command-params">
                      {command.params.length
                        ? command.params
                            .map((param) => `${param.name}${param.required ? '' : '?'}: ${param.type}`)
                            .join(', ')
                        : t.noParams}
                    </span>
                  </header>
                  <p>{language === 'ar' ? command.ar : command.en}</p>
                  <p className="command-sample">
                    <span>{t.example}</span> “{language === 'ar' ? command.sampleAr : command.sampleEn}”
                  </p>
                </article>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
