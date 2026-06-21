import type { GlmCaptchaConfig } from '@shared/ipc'

const CAPTCHA_SCRIPT = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js'
const HOST_ID = 'ascora-zcode-captcha-host'
const ELEMENT_ID = 'ascora-zcode-captcha-element'
const BUTTON_ID = 'ascora-zcode-captcha-button'

interface AliyunCaptchaInstance {
  show?: () => void
  startTracelessVerification?: () => void
}

interface AliyunCaptchaResult {
  success?: boolean
  verifyResult?: boolean
  verifyCode?: string
  captchaVerifyParam?: string
  CaptchaVerifyParam?: string
}

interface AliyunCaptchaOptions {
  SceneId: string
  mode: string
  language: string
  showErrorTip: boolean
  element: string
  button: string
  getInstance: (instance: AliyunCaptchaInstance) => void
  success: (verifyParam: string) => void
  fail: (result: AliyunCaptchaResult) => void
  onError: (error: unknown) => void
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region: string; prefix: string }
    initAliyunCaptcha?: (options: AliyunCaptchaOptions) => void
  }
}

let scriptPromise: Promise<void> | null = null
let activeChallenge: Promise<string> | null = null

function loadCaptchaScript(): Promise<void> {
  if (typeof window.initAliyunCaptcha === 'function') return Promise.resolve()
  if (scriptPromise) return scriptPromise
  const pending = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CAPTCHA_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Aliyun CAPTCHA')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = CAPTCHA_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Aliyun CAPTCHA'))
    document.head.appendChild(script)
  }).catch((err) => {
    scriptPromise = null
    throw err
  })
  scriptPromise = pending
  return pending
}

function mountCaptchaHost(): { host: HTMLDivElement; button: HTMLButtonElement } {
  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement('div')
  host.id = HOST_ID
  // Keep the mount point visually empty while allowing the SDK's popup to
  // extend outside it and receive pointer events.
  host.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483647;width:0;height:0;overflow:visible'

  const element = document.createElement('div')
  element.id = ELEMENT_ID
  host.appendChild(element)

  const button = document.createElement('button')
  button.id = BUTTON_ID
  button.type = 'button'
  button.tabIndex = -1
  button.setAttribute('aria-hidden', 'true')
  button.style.cssText = 'position:fixed;left:50%;top:50%;width:1px;height:1px;opacity:0;pointer-events:auto'
  host.appendChild(button)
  document.body.appendChild(host)
  return { host, button }
}

function resultParam(result: AliyunCaptchaResult): string {
  return (result.captchaVerifyParam ?? result.CaptchaVerifyParam ?? '').trim()
}

async function runChallenge(config: GlmCaptchaConfig): Promise<string> {
  await loadCaptchaScript()
  const init = window.initAliyunCaptcha
  if (typeof init !== 'function') throw new Error('Aliyun CAPTCHA SDK is unavailable')

  const { host, button } = mountCaptchaHost()
  window.AliyunCaptchaConfig = { region: config.region, prefix: config.prefix }

  let instance: AliyunCaptchaInstance | null = null
  let showWhenReady = false
  let settled = false
  let timeoutId: number | undefined

  try {
    const proof = new Promise<string>((resolve, reject) => {
      const finish = (verifyParam?: string, error?: unknown): void => {
        if (settled) return
        settled = true
        if (timeoutId !== undefined) window.clearTimeout(timeoutId)
        if (verifyParam?.trim()) resolve(verifyParam.trim())
        else reject(error instanceof Error ? error : new Error(String(error ?? 'CAPTCHA verification failed')))
      }

      timeoutId = window.setTimeout(() => finish(undefined, new Error('CAPTCHA verification timed out')), 120000)
      init({
        SceneId: config.sceneId,
        mode: config.mode || 'popup',
        language: navigator.language.toLowerCase().startsWith('zh') ? 'cn' : 'en',
        showErrorTip: false,
        element: `#${ELEMENT_ID}`,
        button: `#${BUTTON_ID}`,
        getInstance: (value) => {
          instance = value
          if (showWhenReady) value.show?.()
          else if (typeof value.startTracelessVerification === 'function') value.startTracelessVerification()
          else value.show?.()
        },
        success: (verifyParam) => finish(verifyParam),
        fail: (result) => {
          const verifyParam = resultParam(result)
          if (verifyParam) {
            finish(verifyParam)
            return
          }
          // Aliyun reports this state when silent verification must be upgraded
          // to an interactive popup. It is not a terminal failure.
          if (result.success === true && result.verifyResult === false) {
            showWhenReady = true
            if (instance?.show) instance.show()
            else button.click()
            return
          }
          finish(undefined, new Error(result.verifyCode || 'CAPTCHA verification failed'))
        },
        onError: (error) => finish(undefined, error)
      })
    })
    return await proof
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    host.remove()
  }
}

/** Run the same one-use CAPTCHA preflight used by ZCode desktop Start Plan. */
export function solveZCodeCaptcha(config: GlmCaptchaConfig): Promise<string> {
  if (activeChallenge) return activeChallenge
  activeChallenge = runChallenge(config).finally(() => {
    activeChallenge = null
  })
  return activeChallenge
}
