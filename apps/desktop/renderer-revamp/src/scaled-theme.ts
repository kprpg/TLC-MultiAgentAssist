import { webDarkTheme, webLightTheme } from '@fluentui/react-components'
import { scaleFontTheme } from '../../../shared/font-scale.js'
import { uiFontScale } from './font-scale.js'

export const scaledLightTheme = scaleFontTheme(webLightTheme, uiFontScale)
export const scaledDarkTheme = scaleFontTheme(webDarkTheme, uiFontScale)
