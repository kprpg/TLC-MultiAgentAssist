/// <reference types="vite/client" />

import type { TlcDesktopApi } from '../../electron/preload/index.js'

declare global {
  interface Window {
    tlc: TlcDesktopApi
  }
}

export {}