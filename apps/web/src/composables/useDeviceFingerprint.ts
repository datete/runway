import { ref } from 'vue'

/** Generate a simple but stable browser fingerprint */
function generateFingerprint(): string {
  const components: string[] = []

  // Screen info
  components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`)

  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone)

  // Language
  components.push(navigator.language)

  // Platform
  components.push(navigator.platform || 'unknown')

  // Hardware concurrency
  components.push(String(navigator.hardwareConcurrency || 0))

  // WebGL renderer (GPU fingerprint)
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (debugInfo) {
        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '')
      }
    }
  } catch {}

  // Canvas fingerprint
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 200; canvas.height = 50
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = '14px Arial'
      ctx.fillText('fingerprint:' + navigator.userAgent.slice(0, 20), 2, 2)
      components.push(canvas.toDataURL().slice(-50))
    }
  } catch {}

  // Touch support
  components.push(String('ontouchstart' in window))

  // Hash all components
  const raw = components.join('|')
  return simpleHash(raw)
}

/** Simple hash function (FNV-1a) */
function simpleHash(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Parse browser and OS from user agent */
function parseBrowserInfo() {
  const ua = navigator.userAgent
  let browser = 'Unknown'
  let os = 'Unknown'

  // Browser detection
  if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari'

  // OS detection
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac OS')) os = 'macOS'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

  return { browser, os }
}

const _fingerprint = ref<string>('')
const _deviceInfo = ref<{ fingerprint: string; deviceName: string; browser: string; os: string } | null>(null)

export function useDeviceFingerprint() {
  if (!_fingerprint.value) {
    _fingerprint.value = generateFingerprint()
    const { browser, os } = parseBrowserInfo()
    _deviceInfo.value = {
      fingerprint: _fingerprint.value,
      deviceName: `${browser} on ${os}`,
      browser,
      os,
    }
  }

  return {
    fingerprint: _fingerprint,
    deviceInfo: _deviceInfo,
  }
}
