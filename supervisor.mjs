import http from 'node:http'
import { buildBoard, coerceSnapshot, normId } from './core.mjs'
import { SourceClient, ProviderClient } from './client.mjs'

export class Supervisor {
  constructor(options = {}) {
    this.options = options
    this.sourceClient = options.sourceClient || (options.sourceUrl ? new SourceClient(options.sourceUrl, {
      edition: options.edition ?? process.env.SOURCE_EDITION ?? 'r2',
      fetchImpl: options.fetch
    }) : null)
    this.providerClient = options.providerClient || (options.providerUrl ? new ProviderClient(options.providerUrl, {
      fetchImpl: options.fetch
    }) : null)

    this.snapshot = options.snapshot ? coerceSnapshot(options.snapshot, options) : {
      source: { edition: null, checks: [], stages: [], assignments: [], receipts: [], supersessions: [] },
      provider: { counters: [], batches: [], passes: [] }
    }
    this.gateMap = { ...(options.designatedGates || options.gates || {}) }
    selfFixGateFunctions(this)
    this.returnRecords = [...(options.returns || options.returnReceipts || [])]
    this.delayMap = { ...(options.delays || {}) }
    this.revokeRequests = { ...(options.revokeRequests || {}) }
    this.issuedPasses = [...(options.issuedPasses || [])]
    this.events = []
    this.clock = options.now ?? options.clock ?? null
  }

  viewOptions(extra = {}) {
    return {
      ...this.options,
      ...extra,
      now: extra.now ?? this.clock ?? this.options.now ?? null,
      designatedGates: typeof this.gateMap === 'function'
        ? this.gateMap
        : { ...this.gateMap, ...(extra.designatedGates || {}) },
      returns: [...this.returnRecords, ...(extra.returns || [])],
      delays: { ...this.delayMap, ...(extra.delays || {}) },
      revokeRequests: { ...this.revokeRequests, ...(extra.revokeRequests || {}) }
    }
  }

  async refresh(options = {}) {
    const tasks = []
    if (this.sourceClient) {
      tasks.push(this.sourceClient.snapshot(options.source || {}).then(source => {
        this.snapshot = coerceSnapshot({ ...this.snapshot, source }, this.viewOptions())
      }))
    }
    if (this.providerClient) {
      tasks.push(this.providerClient.snapshot(options.provider || {}).then(provider => {
        this.snapshot = coerceSnapshot({ ...this.snapshot, provider }, this.viewOptions())
      }))
    }
    await Promise.all(tasks)
    this.emit('refreshed', { edition: this.snapshot.source.edition, passes: this.snapshot.provider.passes.length })
    return this.snapshot
  }

  ingest(data = {}) {
    if (data.source || data.streams || data.editions) {
      const source = data.source ? data.source : data
      this.snapshot = coerceSnapshot({ ...this.snapshot, source }, this.viewOptions())
    }
    if (data.provider || data.passes || data.counters || data.batches) {
      const provider = data.provider ? data.provider : data
      this.snapshot = coerceSnapshot({ ...this.snapshot, provider }, this.viewOptions())
    }
    return this.snapshot
  }

  /** 主管新指定门。可调用 designateGate('B')、designateGate('B1','B') 或对象。 */
  designateGate(target, gate) {
    if (target && typeof target === 'object') {
      const { stage, athlete, mask, gate: g } = target
      if (!stage && !athlete && !mask) {
        this.options.gate = normId(g)
        this.emit('gate-designated', { gate: this.options.gate })
        return this.options.gate
      }
      const key = [stage, athlete, mask].filter(Boolean).join(':') || stage || athlete || mask
      this.gateMap[key] = normId(g)
      this.emit('gate-designated', target)
      return this.gateMap[key]
    }
    if (gate === undefined) {
      this.options.gate = normId(target)
      this.emit('gate-designated', { gate: this.options.gate })
      return this.options.gate
    }
    this.gateMap[normId(target)] = normId(gate)
    this.emit('gate-designated', { target, gate })
    return gate
  }

  setGate(...args) { return this.designateGate(...args) }

  delayStage(stage, minutes) {
    if (typeof stage === 'object') Object.assign(this.delayMap, stage)
    else this.delayMap[normId(stage)] = Number(minutes) || 0
    this.emit('delay-recorded', { stage, minutes })
  }

  recordReturn(record) {
    const value = typeof record === 'string' ? { mask: record, at: this.clock } : record
    this.returnRecords.push(value)
    this.emit('mask-returned', value)
  }

  tick(now) {
    this.clock = now
  }

  board(stage, extra = {}) {
    const opts = this.viewOptions(extra)
    if (typeof stage === 'string') opts.stage = stage
    else if (stage && typeof stage === 'object') Object.assign(opts, stage)
    return buildBoard(this.snapshot, opts)
  }

  decide(stageOrOptions, maybeExtra) {
    if (typeof stageOrOptions === 'string') return this.board(stageOrOptions, maybeExtra || {})
    return this.board(undefined, stageOrOptions || {})
  }

  getBoard(stage, extra) { return this.board(stage, extra) }
  decideStage(stage, extra) { return this.board(stage, extra) }

  plan(selector = {}) {
    const board = this.board(selector.stage, selector)
    return this.selectActions(board, selector)
  }

  selectActions(board, selector = {}) {
    let actions = board.stages ? board.actions : (board.actions || [])
    if (selector.athlete) {
      const athletes = board.stages ? board.stages.flatMap(s => s.athletes) : board.athletes || []
      actions = athletes
        .filter(a => normId(a.athlete) === normId(selector.athlete))
        .flatMap(a => a.actions || [])
    }
    if (selector.mask) actions = actions.filter(a => normId(a.mask) === normId(selector.mask))
    if (selector.kind) actions = actions.filter(a => a.kind === selector.kind)
    if (Array.isArray(selector.kinds)) actions = actions.filter(a => selector.kinds.includes(a.kind))
    return [...new Map(actions.map(a => [a.id || `${a.kind}:${JSON.stringify(a.body || {})}`, a])).values()]
  }

  receiveGateReceipt(receipt) {
    const incoming = Array.isArray(receipt) ? receipt : receipt.passes || receipt.state ? [receipt] : []
    const normalized = incoming.map(p => ({
      id: normId(p.pass ?? p.id),
      athlete: normId(p.athlete),
      stage: normId(p.stage) || null,
      mask: normId(p.mask),
      gate: normId(p.gate),
      state: normId(p.state ?? p.status),
      validUntil: p.validUntil ?? p.until ?? null
    })).filter(p => p.id)
    const byId = new Map(this.snapshot.provider.passes.map(p => [p.id, p]))
    for (const pass of normalized) byId.set(pass.id, { ...byId.get(pass.id), ...pass })
    this.snapshot.provider.passes = [...byId.values()]
    this.emit('gate-receipt', normalized)
    return this.snapshot.provider.passes
  }

  async refreshPasses() {
    if (!this.providerClient) return this.snapshot.provider.passes
    const passes = await this.providerClient.passes()
    this.snapshot.provider.passes = passes
    return passes
  }

  async waitForPassState(passId, state = 'revoked', options = {}) {
    const timeoutMs = options.timeoutMs ?? 5000
    const intervalMs = options.intervalMs ?? 50
    const deadline = Date.now() + timeoutMs
    let passes = this.snapshot.provider.passes
    while (Date.now() <= deadline) {
      passes = await this.refreshPasses()
      const pass = passes.find(p => p.id === passId || p.pass === passId)
      if (pass?.state === state) return pass
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
    const error = new Error(`等待通行证 ${passId} 变为 ${state} 超时`)
    error.passes = passes
    throw error
  }

  emit(type, detail) {
    const event = { at: new Date().toISOString(), type, detail }
    this.events.push(event)
    if (typeof this.options.onEvent === 'function') this.options.onEvent(event)
  }

  async run(selector = {}) { return this.process(selector) }

  async process(selector = {}) {
    if (selector.refresh || (!this.snapshot.source.checks.length && this.sourceClient)) {
      await this.refresh(selector.refreshOptions || {})
    }
    const result = { dryRun: Boolean(selector.dryRun), revoked: [], revokePending: [], issued: [], skipped: [], errors: [], board: null }
    let board = this.board(selector.stage, selector)
    let actions = this.selectActions(board, selector)

    // 第一步：处理旧门 loaded 锁。202 只代表旧门开始处理，不代表已经 revoked。
    const revokeActions = actions.filter(a => a.kind === 'revoke' && a.body?.pass && !this.revokeRequests[a.body.pass])
    for (const action of revokeActions) {
      if (selector.dryRun) { result.revoked.push({ action, dryRun: true }); continue }
      if (!this.providerClient) {
        result.errors.push({ action, error: '未配置 providerClient/providerUrl' })
        continue
      }
      const response = await this.providerClient.revoke(action.body)
      this.emit('revoke-response', { action, status: response.status, body: response.body })
      if (response.status === 202 || response.ok) {
        this.revokeRequests[action.body.pass] = { requested: true, status: response.status, at: Date.now(), response: response.body }
        result.revoked.push(action)
        if (response.status === 202) result.revokePending.push(action)
      } else {
        result.errors.push({ action, status: response.status, body: response.body })
      }
    }

    if (revokeActions.length && !selector.allowIssueDuringRevocation) {
      result.board = this.board(selector.stage, selector)
      result.skipped.push({ reason: 'revocation_phase_not_confirmed', message: '已先处理旧门失效；收到 revoked 回执后再继续签发。' })
      return result
    }

    if (!selector.allowIssueDuringRevocation && actions.some(a => a.kind === 'wait_for_revocation_ack')) {
      result.revokePending = actions.filter(a => a.kind === 'wait_for_revocation_ack')
      result.skipped.push({ reason: 'waiting_revocation_ack', message: '旧门尚未确认 revoked；确认前先停在闸机回执环节。' })
      result.board = this.board(selector.stage, selector)
      return result
    }

    // 如果仍有同面罩等待确认，核心看板不会给出 issue 动作。
    board = this.board(selector.stage, selector)
    actions = this.selectActions(board, selector)
    const issueActions = actions.filter(a => a.kind === 'issue' || a.kind === 'reissue_printed_pass')
    for (const action of issueActions) {
      if (selector.mask && normId(action.mask) !== normId(selector.mask)) continue
      if (selector.athlete && normId(action.athlete) !== normId(selector.athlete)) continue
      if (selector.dryRun) { result.issued.push({ action, dryRun: true }); continue }
      if (!this.providerClient) {
        result.errors.push({ action, error: '未配置 providerClient/providerUrl' })
        continue
      }
      const response = await this.providerClient.issue(action.body)
      this.emit('issue-response', { action, status: response.status, body: response.body })
      if (response.status === 200 || response.status === 201 || response.status === 202) {
        const created = { ...action.body, ...(response.body || {}) }
        if (!created.id && created.pass) created.id = created.pass
        this.issuedPasses.push(created)
        if (created.id) {
          const byId = new Map(this.snapshot.provider.passes.map(p => [p.id, p]))
          byId.set(created.id, { state: 'printed', ...created })
          this.snapshot.provider.passes = [...byId.values()]
        }
        result.issued.push({ action, response: response.body })
      } else if (response.status === 409) {
        result.errors.push({ action, status: 409, conflict: response.body })
        await this.refreshPasses().catch(() => {})
      } else {
        result.errors.push({ action, status: response.status, body: response.body })
      }
    }
    result.board = this.board(selector.stage, selector)
    return result
  }

  handleReceipt(receipt) { return this.receiveGateReceipt(receipt) }
  ingestReceipt(receipt) { return this.receiveGateReceipt(receipt) }

  async continueWithReceipt(receipt, selector = {}) {
    this.receiveGateReceipt(receipt)
    return this.process({ ...selector, refresh: false })
  }

  start(...args) {
    return this.listen(...args)
  }

  listen(...args) {
    if (!this._server) {
      // 延迟加载避免 server <-> supervisor 初始化环。
      this._server = http.createServer(async (request, response) => {
        const { createHandler } = await import('./server.mjs')
        createHandler(this, this.options)(request, response)
      })
    }
    return this._server.listen(...args)
  }

  close(callback) {
    if (!this._server) {
      if (typeof callback === 'function') callback()
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      this._server.close(error => {
        this._server = null
        if (error) return reject(error)
        callback?.()
        resolve()
      })
    })
  }

  address() {
    return this._server?.address?.() || null
  }
}

function selfFixGateFunctions(self) {
  // designatedGates 也允许传入函数；viewOptions 会原样交给 core。
  if (typeof self.options.designatedGates === 'function') {
    self.gateMap = self.options.designatedGates
  }
}

export function createSupervisor(options = {}) {
  return new Supervisor(options)
}
