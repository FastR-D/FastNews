import { defineConfig, presetWind3 } from 'unocss'
import { fastUIContent, presetFastUI } from '@fastrd/ui-foundation/uno'

export default defineConfig({
  content: fastUIContent,
  presets: [presetWind3(), presetFastUI()],
})
