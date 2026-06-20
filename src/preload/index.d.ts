import type { AscoraApi } from './index'

declare global {
  interface Window {
    ascora: AscoraApi
  }
}

export {}
