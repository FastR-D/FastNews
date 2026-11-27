import { useEffect, useState } from 'react'
import { Button } from '@fastrd/ui-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel } from './Common'

export default function NewsArchive({
  date,
  dates,
  onSelect,
}: {
  date: string
  dates: string[]
  onSelect: (date: string) => void
}) {
  const [month, setMonth] = useState(date.slice(0, 7))
  useEffect(() => {
    if (date) setMonth(date.slice(0, 7))
  }, [date])
  const available = new Set(dates)
  const first = new Date(`${month || new Date().toISOString().slice(0, 7)}-01T00:00:00`)
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const offset = (first.getDay() + 6) % 7
  function move(delta: number) {
    const next = new Date(first.getFullYear(), first.getMonth() + delta, 1)
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }
  return (
    <Panel title="资讯日历">
      <div data-testid="calendar" className="p-3">
        <div className="flex items-center justify-between mb-3">
          <Button
            variant="icon"
            aria-label="上个月"
            disabled={!!dates.length && month <= dates[dates.length - 1].slice(0, 7)}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <strong>{month.replace('-', ' 年 ')} 月</strong>
          <Button
            variant="icon"
            aria-label="下个月"
            disabled={!!dates.length && month >= dates[0].slice(0, 7)}
            onClick={() => move(1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {'一二三四五六日'.split('').map((d) => (
            <span className="text-center text-[var(--fastui-muted)]" key={d}>
              {d}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={`empty-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = `${month}-${String(i + 1).padStart(2, '0')}`
            return (
              <Button
                key={day}
                variant={day === date ? 'primary' : 'quiet'}
                title={available.has(day) ? '当天有采集档案' : '当天无采集档案'}
                aria-label={day}
                aria-pressed={day === date}
                disabled={!available.has(day)}
                onClick={() => onSelect(day)}
              >
                {i + 1}
              </Button>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
