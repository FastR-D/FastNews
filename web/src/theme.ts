import { initColorMode } from '@fastrd/ui-foundation'
// Keep the preference used by the previous site and the other FastRD products.
try {
  if (localStorage.getItem('fastresearch-theme') === null) {
    const previous =
      localStorage.getItem('fastnews-theme') || localStorage.getItem('fastnews.theme')
    if (previous === 'light' || previous === 'dark' || previous === 'system') {
      localStorage.setItem('fastresearch-theme', previous)
    }
  }
} catch {
  // Foundation still initializes when browser preference storage is unavailable.
}
export const theme = initColorMode({ storageKey: 'fastresearch-theme' })
