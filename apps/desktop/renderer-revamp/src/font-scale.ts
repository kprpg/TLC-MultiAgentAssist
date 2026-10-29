import { uiFontScale as additionalFontScale } from '../../../shared/font-scale.js'

// Preserve the renderer's previous reduction when applying the additional five percent.
export const uiFontScale = 0.95 * additionalFontScale
