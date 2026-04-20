export interface EvidencePage {
  screenshot: (opts: { fullPage?: boolean }) => Promise<Buffer>
  url?: () => string
  waitForLoadState?: (state: 'domcontentloaded' | 'load' | 'networkidle', opts?: { timeout?: number }) => Promise<void>
  evaluate?: <T>(fn: () => T | Promise<T>) => Promise<T>
}

type BrowserStyle = {
  display?: string
  opacity?: string | number
  visibility?: string
}

type BrowserRect = {
  width?: number
  height?: number
}

type BrowserElement = {
  getBoundingClientRect?: () => BrowserRect
}

type BrowserBody = {
  innerText?: string
  textContent?: string
  querySelectorAll?: (selector: string) => ArrayLike<BrowserElement>
}

type BrowserGlobal = {
  document?: {
    body?: BrowserBody | null
  }
  getComputedStyle?: (element: BrowserElement) => BrowserStyle
}

export function getEvidencePageUrl(page: EvidencePage): string | null {
  if (!page.url) return null

  try {
    return page.url()
  } catch {
    return null
  }
}

export async function hasRenderablePageContent(page: EvidencePage): Promise<boolean> {
  const url = getEvidencePageUrl(page)

  if (url === 'about:blank') return false
  if (!page.evaluate) return true

  if (page.waitForLoadState) {
    await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {})
  }

  try {
    return await page.evaluate(() => {
      const browser = globalThis as unknown as BrowserGlobal
      const body = browser.document?.body
      if (!body) return false

      const text = (body.innerText || body.textContent || '').replace(/\s+/g, '').trim()
      if (text.length > 0) return true

      const visibleSelectors = [
        'a',
        'button',
        'canvas',
        'form',
        'img',
        'input',
        'main',
        'select',
        'svg',
        'textarea',
        '[data-testid]',
        '[role]',
      ].join(',')

      return Array.from(body.querySelectorAll?.(visibleSelectors) ?? []).some((element) => {
        const style = browser.getComputedStyle?.(element) ?? {}
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false
        }

        const rect = element.getBoundingClientRect?.() ?? {}
        return Number(rect.width ?? 0) > 1 && Number(rect.height ?? 0) > 1
      })
    })
  } catch {
    return true
  }
}
