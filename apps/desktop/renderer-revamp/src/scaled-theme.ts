import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components'
import { uiFontScale } from './font-scale.js'

const fontSizeTokens = [
  'fontSizeBase100', 'fontSizeBase200', 'fontSizeBase300', 'fontSizeBase400', 'fontSizeBase500', 'fontSizeBase600',
  'fontSizeHero700', 'fontSizeHero800', 'fontSizeHero900', 'fontSizeHero1000'
] as const

// Scaling the theme keeps Fluent portals (menus, dialogs, drawers) consistent with in-tree content.
function scaleFontTheme(theme: Theme): Theme {
  const scaled: Theme = { ...theme }
  for (const token of fontSizeTokens) {
    scaled[token] = `${Number((Number.parseFloat(theme[token]) * uiFontScale).toFixed(3))}px`
  }
  return scaled
}

export const scaledLightTheme = scaleFontTheme(webLightTheme)
export const scaledDarkTheme = scaleFontTheme(webDarkTheme)
