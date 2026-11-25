import { parseTsv } from './core.mjs'

function joinUrl(base, path) {
  return new URL(path, base).toString()
}

async function readJson(response) {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return { raw: text } }
}

export class SourceClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.edition = options.edition ?? null
    this.timeoutMs = options.timeoutMs ?? 10000
    this.cache = new Map()
  }

  async request(url, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  async fetchStream(name, query = {}) {
    const params = new URLSearchParams()
    const edition = query.edition ?? this.edition
    if (edition) params.set('edition', edition)
    if (query.key !== undefined && query.key !== null) params.set('key', query.key)
    if (query.from !== undefined && query.from !== null) params.set('from', String(query.from))
    if (query.until !== undefined && query.until !== null) params.set('until', String(query.until))
    let path = `/records/${name}` + (params.size ? `?${params}` : '')
    const rows = []
    let actualEdition = null
    let pages = 0
    while (path) {
      pages += 1
      if (pages > 10000) throw new Error('来源分页超过安全上限')
      const url = joinUrl(this.baseUrl, path)
      const cached = this.cache.get(url)
      const headers = {}
      if (cached?.etag) headers['If-None-Match'] = cached.etag
      const response = await this.request(url, { headers })
      if (response.status === 304 && cached) {
        rows.push(...cached.rows)
        path = cached.nextPath
        actualEdition ||= cached.edition
        continue
      }
      if (!response.ok) {
        const body = await readJson(response).catch(() => null)
        const error = new Error(`读取 ${name} 失败：HTTP ${response.status}`)
        error.status = response.status
        error.body = body
        error.url = url
        throw error
      }
      actualEdition = response.headers.get('X-Edition') || actualEdition
      const text = await response.text()
      const pageRows = parseTsv(text)
      rows.push(...pageRows)
      const link = response.headers.get('link')
      const nextMatch = link ? /^<([^>]+)>/.exec(link) : null
      const nextPath = nextMatch ? nextMatch[1] : null
      const etag = response.headers.get('etag')
      if (etag) this.cache.set(url, { etag, rows: pageRows, nextPath, edition: actualEdition })
      path = nextPath
    }
    return { rows, edition: actualEdition, name }
  }

  async catalog() {
    const res = await this.request(joinUrl(this.baseUrl, '/catalog'))
    if (!res.ok) throw new Error(`读取 catalog 失败：HTTP ${res.status}`)
    return res.json()
  }

  async snapshot(options = {}) {
    const edition = options.edition ?? this.edition
    const names = options.streams || ['check', 'stage', 'assign', 'receipt', 'supersedes']
    const streams = {}
    let actualEdition = null
    for (const name of names) {
      try {
        const result = await this.fetchStream(name, { ...options, edition })
        streams[name] = result.rows
        actualEdition ||= result.edition
      } catch (error) {
        const editionMissing = error.status === 404 && String(error.body?.error || '').includes('资料版')
        if (editionMissing && edition && options.fallbackToDefault !== false) {
          return this.snapshot({ ...options, edition: null, fallbackToDefault: false })
        }
        // 新资料版可能尚未提供 supersedes 等流；404 按空资料处理。
        if (error.status === 404 && options.allowMissing !== false) {
          streams[name] = []
          continue
        }
        // 指定资料版不可读时，回退到来源当前资料版。
        if (edition && options.fallbackToDefault !== false && [400, 409, 422].includes(error.status)) {
          return this.snapshot({ ...options, edition: null, fallbackToDefault: false })
        }
        throw error
      }
    }
    return { edition: actualEdition || edition, streams }
  }

  async control(edition) {
    const res = await this.request(joinUrl(this.baseUrl, `/control?edition=${encodeURIComponent(edition)}`), { method: 'POST' })
    return { status: res.status, body: await readJson(res) }
  }
}

export async function fetchSourceSnapshot(baseUrl, options = {}) {
  const client = options.client || new SourceClient(baseUrl, options)
  return client.snapshot(options)
}

export async function fetchProviderSnapshot(baseUrl, options = {}) {
  const client = options.client || new ProviderClient(baseUrl, options)
  return client.snapshot(options)
}

export const loadSource = fetchSourceSnapshot
export const loadProvider = fetchProviderSnapshot
export function createClient(kind, baseUrl, options) {
  return kind === 'provider' || kind === 'gate' || kind === 'turnstile'
    ? new ProviderClient(baseUrl, options)
    : new SourceClient(baseUrl, options)
}

export class ProviderClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 10000
  }

  async request(path, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers = { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) }
      const response = await this.fetchImpl(joinUrl(this.baseUrl, path), { ...init, headers, signal: controller.signal })
      const body = await readJson(response)
      return { status: response.status, ok: response.ok, body, headers: response.headers }
    } finally {
      clearTimeout(timer)
    }
  }

  counters() {
    return this.request('/inspection/counters').then(r => r.body || [])
  }

  batch(counter, part) {
    const q = new URLSearchParams({ counter, part: String(part) })
    return this.request(`/inspection/batch?${q}`)
  }

  async inspectionSnapshot(options = {}) {
    const counters = await this.counters()
    const batches = []
    const concurrency = options.concurrency ?? 4
    const tasks = []
    for (const counter of counters || []) {
      const [lo, hi] = counter.range || []
      if (lo === null || hi === null) continue
      const missing = new Set(counter.missing || [])
      for (let part = lo; part <= hi; part += 1) {
        if (missing.has(part) && options.skipMissing !== false) continue
        tasks.push(async () => {
          const result = await this.batch(counter.counter, part)
          if (result.status === 404 && options.ignoreMissingBatches !== false) return
          if (!result.ok) {
            if (options.strict) throw new Error(`读取检查台批次失败 ${counter.counter}#${part}: ${result.status}`)
            return
          }
          batches.push({ counter: counter.counter, area: counter.area || null, part, rows: result.body || [] })
        })
      }
    }
    let index = 0
    async function worker() {
      while (index < tasks.length) {
        const task = tasks[index++]
        await task()
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    return { counters: counters || [], batches }
  }

  passes() {
    return this.request('/turnstile/passes').then(r => r.body || [])
  }

  revoke(payload) {
    return this.request('/turnstile/revoke', { method: 'POST', body: JSON.stringify(payload) })
  }

  issue(payload) {
    return this.request('/turnstile/issue', { method: 'POST', body: JSON.stringify(payload) })
  }

  async snapshot(options = {}) {
    const [inspection, passes] = await Promise.all([
      this.inspectionSnapshot(options.inspection || {}),
      this.passes()
    ])
    return { ...inspection, passes }
  }

  lab(stage) {
    return this.request(`/lab?stage=${encodeURIComponent(stage)}`, { method: 'POST' })
  }
}
