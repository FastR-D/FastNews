import { Button } from '@fastrd/ui-react'

export default function CollectionDate({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="collection-date">
      <input
        className="reading-field"
        type="date"
        aria-label="采集日期"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Button variant="quiet" onClick={() => onChange('')}>
        最新
      </Button>
    </div>
  )
}
