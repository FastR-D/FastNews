import { Button } from '@fastrd/ui-react'
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { Globe2, ShieldCheck, Sparkles } from 'lucide-react'
import './Reading.css'

export function ReadingSurface({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`reading-surface ${className}`} {...props} />
}
export function ReadingButton({
  variant = 'secondary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'quiet' | 'icon' }) {
  return (
    <button
      type="button"
      className={`reading-action reading-action--${variant} ${className}`}
      {...props}
    />
  )
}
export function ReadingInput({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`reading-field ${className}`} {...props} />
}
export function ReadingSelect({ className = '', ...props }: ComponentProps<'select'>) {
  return <select className={`reading-field ${className}`} {...props} />
}
export function ReadingHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      {action}
    </header>
  )
}
export function SourceMark({
  category,
  size = 'small',
}: {
  category?: string
  size?: 'small' | 'large'
}) {
  const kind =
    category === 'security' || category === 'cve'
      ? 'security'
      : category === 'ai' || category === 'research'
        ? 'ai'
        : 'news'
  const Icon = kind === 'security' ? ShieldCheck : kind === 'ai' ? Sparkles : Globe2
  return (
    <span aria-hidden="true" className={`source-mark source-mark--${kind} source-mark--${size}`}>
      <Icon size={size === 'large' ? 21 : 14} />
    </span>
  )
}
export function ReadingTabs({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="button-tabs reading-tabs">
      {options.map((option) => (
        <Button
          variant={value === option.value ? 'primary' : 'secondary'}
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
