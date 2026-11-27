import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@fastrd/ui-react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useApp } from '../context'

function key(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function parse(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  return key(date) === value ? date : null
}
function offset(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
}

export default function CollectionDate({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { catalog } = useApp()
  const available = new Set(catalog?.dates || [])
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(value || key(new Date()))
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useEffect(() => setDraft(value), [value])
  const selected = parse(focused) || new Date()
  const year = selected.getFullYear(),
    month = selected.getMonth()
  const first = new Date(year, month, 1, 12)
  const start = offset(first, -((first.getDay() + 6) % 7))
  const monthLabel = `${year}年${month + 1}月`
  useEffect(() => {
    if (open)
      popover.current
        ?.querySelector<HTMLButtonElement>('[data-focused="true"]')
        ?.focus({ preventScroll: true })
  }, [open, focused])
  useEffect(() => {
    if (!open) return
    const close = () => {
      popover.current?.hidePopover()
      setOpen(false)
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close)
    }
  }, [open])
  function show() {
    if (open) {
      popover.current?.hidePopover()
      return
    }
    const rect = trigger.current!.getBoundingClientRect()
    setPosition({
      left: Math.max(12, Math.min(rect.right - 336, window.innerWidth - 348)),
      top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 425)),
    })
    setFocused(value || key(new Date()))
    popover.current?.showPopover()
    setOpen(true)
  }
  function choose(next: string) {
    setDraft(next)
    onChange(next)
    popover.current?.hidePopover()
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }
  function moveMonth(step: number) {
    const last = new Date(year, month + step + 1, 0).getDate()
    setFocused(key(new Date(year, month + step, Math.min(selected.getDate(), last), 12)))
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const shift: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -((date.getDay() + 6) % 7),
      End: 6 - ((date.getDay() + 6) % 7),
    }
    if (event.key in shift) {
      event.preventDefault()
      setFocused(key(offset(date, shift[event.key])))
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      moveMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1))
    }
  }
  return (
    <div className="collection-date">
      <div className="collection-date-field">
        <input
          className="reading-field"
          type="text"
          inputMode="numeric"
          aria-label="采集日期"
          placeholder="YYYY-MM-DD"
          value={draft}
          aria-invalid={!!draft && !parse(draft)}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            if (!next || parse(next)) onChange(next)
          }}
          onBlur={() => {
            if (draft && !parse(draft)) setDraft(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              show()
            }
          }}
        />
        <button
          type="button"
          ref={trigger}
          className="collection-date-trigger"
          aria-label="打开采集日历"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          onClick={show}
        >
          <CalendarDays size={17} />
        </button>
      </div>
      <Button variant="quiet" onClick={() => choose('')}>
        最新
      </Button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="选择采集日期"
        className="collection-calendar"
        style={position}
        onToggle={(e) => setOpen(e.newState === 'open')}
      >
        <header>
          <strong aria-live="polite">{monthLabel}</strong>
          <button type="button" aria-label="上个月" onClick={() => moveMonth(-1)}>
            <ChevronLeft size={17} />
          </button>
          <button type="button" aria-label="下个月" onClick={() => moveMonth(1)}>
            <ChevronRight size={17} />
          </button>
        </header>
        <table role="grid" aria-label={monthLabel}>
          <thead>
            <tr>
              {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                <th key={day} scope="col">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {Array.from({ length: 7 }, (_, day) => {
                  const date = offset(start, week * 7 + day),
                    dateKey = key(date)
                  return (
                    <td key={dateKey} aria-selected={value === dateKey}>
                      <button
                        type="button"
                        data-focused={focused === dateKey}
                        data-outside-month={date.getMonth() !== month}
                        data-today={dateKey === key(new Date())}
                        data-selected={value === dateKey}
                        tabIndex={focused === dateKey ? 0 : -1}
                        aria-label={dateKey}
                        aria-current={dateKey === key(new Date()) ? 'date' : undefined}
                        onKeyDown={(e) => keyboard(e, date)}
                        onClick={() => choose(dateKey)}
                      >
                        {date.getDate()}
                        {available.has(dateKey) && <span className="calendar-dot" />}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <footer>
          <span>
            <i className="calendar-dot" />
            有采集数据
          </span>
          <button type="button" onClick={() => choose(key(new Date()))}>
            今天
          </button>
        </footer>
      </div>
    </div>
  )
}
