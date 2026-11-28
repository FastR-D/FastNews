import { Button } from '@fastrd/ui-react'

type Tab = { id: string; label: string; controls: string }

export function ButtonTabs({
  tabs,
  activeId,
  onSelect,
  label,
}: {
  tabs: Tab[]
  activeId: string
  onSelect: (id: string) => void
  label: string
}) {
  return (
    <div className="button-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <Button
          key={tab.id}
          id={tab.id}
          role="tab"
          variant={activeId === tab.id ? 'primary' : 'secondary'}
          aria-selected={activeId === tab.id}
          aria-controls={tab.controls}
          tabIndex={activeId === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : -1
            if (next < 0) return
            event.preventDefault()
            onSelect(tabs[next].id)
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            buttons?.[next].focus()
          }}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  )
}
