// 纯领域规则：资料归一化、复检证据、领用占用、通行证状态和主管看板。
// 该模块不访问网络，既可供 HTTP 服务使用，也可直接被测试调用。

export const ITEMS = Object.freeze(['strap', 'shell'])
export const ITEM_ALIASES = Object.freeze({
  strap: 'strap',
  band: 'strap',
  绑带: 'strap',
  带子: 'strap',
  shell: 'shell',
  mask_shell: 'shell',
  外壳: 'shell',
  面罩外壳: 'shell'
})

export const PASS_STATES = Object.freeze({
  PRINTED: 'printed',
  LOADED: 'loaded',
  ENTERED: 'entered',
  REVOKED: 'revoked'
})

export function verdictFor(status) {
  if (status === 'can_pass_at_designated_gate') return 'pass_now'
  if (status === 'ready_to_issue') return 'issue_pass'
  if (status === 'inside_mask_retained') return 'retain_entered_mask'
  if (status === 'waiting_revocation_ack' || status === 'revoke_required') return 'manual_existing_pass'
  if (status === 'inspection_needed') return 'reinspect'
  if (status === 'mask_occupied') return 'occupy_or_borrow'
  if (status === 'entry_closed') return 'closed'
  return 'manual_review'
}

export const STATUS_LABELS = Object.freeze({
  ready_to_issue: '可发证',
  can_pass_at_designated_gate: '可过主管指定门',
  inside_mask_retained: '已过闸，面罩优先暂留',
  waiting_revocation_ack: '暂留：等待旧门确认失效',
  revoke_required: '须先撤销旧门已接收单',
  inspection_needed: '需要裁判复检',
  mask_occupied: '面罩占用/重叠',
  entry_closed: '入场已截止',
  manual_review: '需要人工处理',
  no_assignment: '无领用记录'
})

const PASS_RESULTS = new Set(['pass', 'passed', 'ok', 'valid', 'qualified', 'true', '1', '合格', '通过'])
const FAIL_RESULTS = new Set(['fail', 'failed', 'reject', 'rejected', 'invalid', 'false', '0', '不合格', '未通过'])

export function stableId(prefix, parts) {
  return prefix + ':' + parts.map(encodeURIComponent).join('/')
}

export function asNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '' || value === '-') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function asString(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value)
}

export function normId(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

export function normItem(value) {
  const key = normId(value).toLowerCase().replace(/[\s-]+/g, '_')
  return ITEM_ALIASES[key] || ITEM_ALIASES[normId(value)] || (ITEMS.includes(key) ? key : key || 'unknown')
}

export function normResult(value) {
  const key = normId(value).toLowerCase()
  if (PASS_RESULTS.has(key)) return 'pass'
  if (FAIL_RESULTS.has(key)) return 'fail'
  return key || 'unknown'
}

export function normState(value) {
  return normId(value).toLowerCase()
}

export function parseTsv(text) {
  if (!text) return []
  return String(text)
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.split('\t'))
}

function getField(row, index, names) {
  if (Array.isArray(row)) return row[index]
  if (row && typeof row === 'object') {
    for (const name of names) {
      if (row[name] !== undefined) return row[name]
    }
  }
  return undefined
}

function rowValue(row, index, names, fallback = '') {
  const value = getField(row, index, names)
  return value === undefined ? fallback : value
}

export function normalizeCheck(row) {
  return {
    id: normId(rowValue(row, 0, ['id', 'check', 'checkId', 'proof', 'credential', '检查号'])),
    mask: normId(rowValue(row, 1, ['mask', 'maskId', 'gear', '面罩'])),
    weapon: normId(rowValue(row, 2, ['weapon', 'sword', 'event', '剑种'])) || '*',
    area: normId(rowValue(row, 3, ['area', 'region', 'scope', 'place', 'location', '区域', '地点', '范围'])) || '*',
    item: normItem(rowValue(row, 4, ['item', 'part', 'component', '项目'])),
    start: asNumber(rowValue(row, 5, ['start', 'from', 'begin', 'startTime', '起'])),
    end: asNumber(rowValue(row, 6, ['end', 'until', 'to', 'finish', '止'])),
    result: normResult(rowValue(row, 7, ['result', 'outcome', 'status', '结论', '结果'])),
    raw: row
  }
}

export function normalizeStage(row) {
  return {
    id: normId(rowValue(row, 0, ['id', 'stage', 'stageId', 'session', '场号'])),
    area: normId(rowValue(row, 1, ['area', 'region', 'zone', '区域'])),
    weapon: normId(rowValue(row, 2, ['weapon', 'sword', '剑种'])) || '*',
    start: asNumber(rowValue(row, 3, ['start', 'from', 'startTime', '起'])),
    end: asNumber(rowValue(row, 4, ['end', 'until', 'to', 'endTime', '止'])),
    status: normId(rowValue(row, 5, ['status', 'state', '比赛状态'])) || 'unknown',
    entryDeadline: asNumber(getField(row, 6, ['entryDeadline', 'deadline', 'entryClose', 'checkinDeadline']), undefined),
    gate: normId(getField(row, 7, ['gate', 'designatedGate', '门'])) || undefined,
    raw: row
  }
}

export function normalizeAssignment(row) {
  const key = rowValue(row, 0, ['stage', 'stageId', 'session', '场号'])
  return {
    stage: normId(key),
    athlete: normId(rowValue(row, 1, ['athlete', 'player', 'fencer', 'person', '运动员', '选手'])),
    mask: normId(rowValue(row, 2, ['mask', 'maskId', 'gear', '面罩'])),
    start: asNumber(rowValue(row, 3, ['start', 'from', 'borrowStart', '起借'])),
    end: asNumber(rowValue(row, 4, ['end', 'until', 'borrowEnd', '还'])),
    receipt: (() => {
      const v = rowValue(row, 5, ['receipt', 'signature', 'sign', 'voucher', '签收凭据'])
      const s = normId(v)
      return !s || s === '-' ? null : s
    })(),
    raw: row
  }
}

export function normalizeReceipt(row) {
  const proofsValue = rowValue(row, 2, ['proofs', 'checks', 'received', 'ids', '收到的检查号'], '')
  const proofs = Array.isArray(proofsValue)
    ? proofsValue.map(normId).filter(Boolean)
    : normId(proofsValue).split(',').map(normId).filter(Boolean)
  const missingValue = rowValue(row, 3, ['missing', 'missingCursor', 'gap', '缺页游标'], '-')
  const missing = normId(missingValue)
  return {
    area: normId(rowValue(row, 0, ['area', 'region', 'zone', '区域'])),
    revision: normId(rowValue(row, 1, ['revision', 'rev', 'pageRevision', '分页修订'])),
    proofs,
    missing: !missing || missing === '-' ? null : missing,
    raw: row
  }
}

export function normalizeSupersession(row) {
  if (Array.isArray(row)) {
    return { oldId: normId(row[0]), newId: normId(row[1]) }
  }
  return {
    oldId: normId(row.oldId ?? row.old ?? row.from ?? row.superseded ?? row.supersedes),
    newId: normId(row.newId ?? row.new ?? row.to ?? row.replacement ?? row.proof)
  }
}

export function normalizeCounter(row) {
  return {
    counter: normId(row.counter ?? row.id ?? row.desk ?? row['台号']),
    area: normId(row.area ?? row.region ?? row.zone ?? row['区域']) || null,
    range: Array.isArray(row.range) ? [asNumber(row.range[0]), asNumber(row.range[1])] : null,
    missing: Array.isArray(row.missing) ? row.missing.map(x => asNumber(x)).filter(x => x !== null) : [],
    raw: row
  }
}

export function normalizeBatch(row, context = {}) {
  const seq = asNumber(row.seq ?? row.sequence ?? row.localSeq ?? row.part)
  const part = asNumber(context.part ?? row.part ?? seq)
  const checkLike = normalizeCheck(row)
  return {
    ...checkLike,
    counter: normId(context.counter ?? row.counter ?? row.desk),
    area: normId(context.area ?? row.area ?? row.region ?? checkLike.area) || null,
    part,
    seq,
    id: normId(row.proof ?? row.id ?? row.check ?? row.credential ?? row.proofId ?? checkLike.id),
    supersedes: normId(row.supersedes ?? row.old ?? row.corrects ?? row.correctedCredential) || null,
    item: row.item ? normItem(row.item) : checkLike.item,
    result: row.outcome || row.result || row.status ? normResult(row.outcome ?? row.result ?? row.status) : checkLike.result,
    raw: row
  }
}

export function normalizePass(row) {
  return {
    id: normId(row.pass ?? row.id ?? row.passId ?? row.credential ?? row['通行凭据']),
    athlete: normId(row.athlete ?? row.player ?? row.fencer ?? row['运动员']),
    stage: normId(row.stage ?? row.stageId ?? row.session ?? row['场号']) || null,
    mask: normId(row.mask ?? row.maskId ?? row.gear ?? row['面罩']),
    gate: normId(row.gate ?? row.targetGate ?? row.door ?? row['门']),
    state: normState(row.state ?? row.status),
    validUntil: asNumber(row.validUntil ?? row.until ?? row.deadline ?? row.entryDeadline, null),
    raw: row
  }
}

function normalizeSource(source = {}) {
  if (!source) return emptySource()
  if (source.edition && source.streams === undefined) {
    // 兼容直接传入某一 edition 对象。
    source = source
  }
  const streams = source.streams || source
  const map = (value, fn) => Array.isArray(value) ? value.map(fn) : []
  return {
    edition: normId(source.edition) || null,
    checks: map(streams.checks ?? streams.check, normalizeCheck),
    stages: map(streams.stages ?? streams.stage, normalizeStage),
    assignments: map(streams.assignments ?? streams.assign, normalizeAssignment),
    receipts: map(streams.receipts ?? streams.receipt, normalizeReceipt),
    supersessions: map(streams.supersessions ?? streams.supersedes, normalizeSupersession)
  }
}

export function emptySource() {
  return { edition: null, checks: [], stages: [], assignments: [], receipts: [], supersessions: [] }
}

export function providerScenarioData(record = {}, stageName = 'merge') {
  const routes = [
    ...(record.stages?.[stageName] || []),
    ...(record.common || [])
  ]
  const findBody = predicate => routes.find(predicate)?.body
  return {
    counters: findBody(r => r.path === '/inspection/counters') || [],
    passes: findBody(r => r.path === '/turnstile/passes') || [],
    batches: routes
      .filter(r => r.path === '/inspection/batch')
      .map(r => ({ counter: r.query?.counter, part: Number(r.query?.part), rows: r.body || [] }))
  }
}

function normalizeProvider(provider = {}, options = {}) {
  if (Array.isArray(provider)) return { counters: [], batches: [], passes: provider.map(normalizePass) }
  if (provider.stages && !provider.passes && !provider.counters) {
    provider = providerScenarioData(provider, options.providerStage || options.scenario || 'merge')
  }
  const counters = (provider.counters || []).map(normalizeCounter)
  const batches = []
  for (const batch of provider.batches || []) {
    if (Array.isArray(batch)) {
      const context = batch.__context || {}
      for (const row of batch) batches.push(normalizeBatch(row, context))
    } else if (Array.isArray(batch.rows)) {
      for (const row of batch.rows) batches.push(normalizeBatch(row, batch))
    } else {
      batches.push(normalizeBatch(batch, batch))
    }
  }
  return {
    counters,
    batches,
    passes: (provider.passes || []).map(normalizePass)
  }
}

/**
 * 接受多种测试/调用形态：
 * - {source:{edition,streams}, provider:{...}}
 * - {edition:'r2', streams:{...}, passes:[...]}
 * - 直接传入 source edition
 */
export function coerceSnapshot(input = {}, extra = {}) {
  let sourceInput = input.source ?? input.snapshot?.source ?? input
  let providerInput = input.provider ?? input.snapshot?.provider ?? {}
  if (input.editions && !input.streams) {
    const wantedEdition = extra.edition || input.edition
    sourceInput = input.editions.find(e => e.edition === wantedEdition) || input.editions[input.editions.length - 1]
  }
  if (!input.provider && input.stages && !Array.isArray(input.stages) && !input.streams) {
    providerInput = input
    sourceInput = {}
  }
  // 如果同一层既有 streams 又有 passes，passes 属于 provider。
  if (input.streams && input.passes && !input.provider) {
    providerInput = { passes: input.passes, counters: input.counters, batches: input.batches }
  }
  const source = normalizeSource(sourceInput)
  const provider = normalizeProvider(providerInput, extra)
  return mergeSnapshot({ source, provider }, extra)
}

export function mergeSnapshot(...snapshots) {
  const result = { source: emptySource(), provider: { counters: [], batches: [], passes: [] } }
  for (const item of snapshots.flat()) {
    if (!item) continue
    const s = item.source ? normalizeSource(item.source) : (item.checks || item.streams ? normalizeSource(item) : null)
    if (s) {
      result.source.edition ||= s.edition
      for (const k of ['checks', 'stages', 'assignments', 'receipts', 'supersessions']) result.source[k].push(...s[k])
    }
    if (item.provider || item.passes || item.counters || item.batches) {
      const p = item.provider ? normalizeProvider(item.provider) : normalizeProvider(item)
      result.provider.counters.push(...p.counters)
      result.provider.batches.push(...p.batches)
      result.provider.passes.push(...p.passes)
    }
  }
  return result
}

export function intervalsOverlap(a, b) {
  if (!a || !b || a.start === null || a.end === null || b.start === null || b.end === null) return false
  return a.start < b.end && b.start < a.end
}

export function intervalCovers(cover, target) {
  if (!cover || !target) return false
  if (cover.start === null || cover.end === null || target.start === null || target.end === null) return false
  return cover.start <= target.start && cover.end >= target.end
}

export function areasMatch(claimArea, actualArea, options = {}) {
  const claim = normId(claimArea) || '*'
  const actual = normId(typeof actualArea === 'function' ? actualArea(options) : actualArea)
  if (!actual) return true // 未指定实际区域时不把区域规则变成误报。
  if (claim === '*' || claim.toLowerCase() === 'all') return true
  if (claim === actual) return true
  const aliases = options.areaAliases || options.regions || {}
  const actualSet = new Set([actual, ...(aliases[actual] || [])].map(normId))
  if (actualSet.has(claim)) return true
  // 合并区可声明为数组/集合；凭据属于其中任一旧区时，只证明该旧区。
  if (Array.isArray(actualArea) && actualArea.map(normId).includes(claim)) return true
  return false
}

function keyValue(object, key) {
  if (!object) return undefined
  if (object instanceof Map) return object.get(key)
  return object[key] ?? object[String(key)]
}

export function designatedGateFor(stage, athlete, mask, options = {}) {
  const map = options.designatedGates || options.gates || options.gateFor || {}
  const keys = [
    `${stage}:${athlete}:${mask}`,
    `${stage}:${athlete}`,
    `${stage}:${mask}`,
    stage,
    athlete,
    mask
  ]
  if (typeof map === 'function') {
    for (const key of keys) {
      const v = map(key, { stage, athlete, mask })
      if (v) return normId(v)
    }
    return normId(options.gate) || normId(stage?.gate) || null
  }
  for (const key of keys) {
    const v = keyValue(map, key)
    if (v) return normId(v)
  }
  return normId(options.gate) || normId(options.designatedGate) || normId(options.newGate) || normId(options.targetGate) || normId(options.destinationGate) || normId(stage?.gate) || normId(stage?.area) || null
}

export function actualAreaFor(stage, gate, options = {}) {
  const explicit = options.actualArea || options.actualRegion || options.region || options.area || options.areas?.[stage?.id] || options.areaFor?.(stage, gate)
  if (explicit) return normId(explicit)
  if (gate && options.gateAreas?.[gate]) return normId(options.gateAreas[gate])
  const stageArea = normId(stage?.area)
  // 来源演练档的门号与旧区编号一致；主管把 A1 改到 B 门时，实际管辖区域随之按 B 判断。
  if (gate && options.inferAreaFromGate !== false && (!stageArea || gate !== stageArea || !stageArea)) {
    return normId(gate)
  }
  return stageArea || normId(gate) || null
}

export function preferredMaskFor(stageId, athlete, options = {}) {
  const map = options.preferredMasks || options.maskChoices || {}
  if (typeof map === 'function') return normId(map({ stage: stageId, athlete })) || null
  return normId(map[`${stageId}:${athlete}`] || map[stageId] || map[athlete]) || null
}

function candidateRank(candidate, preferredMask) {
  let score = 0
  if (preferredMask && candidate.mask === preferredMask) score += 1000
  // 能覆盖场次开始/领用窗口更长的面罩优先；例如 M2 35-55 优于 M 40-55。
  if (candidate.assignmentInterval?.start !== null) score += Math.max(0, 100 - candidate.assignmentInterval.start)
  if (candidate.assignmentInterval?.end !== null) score += candidate.assignmentInterval.end / 100
  score -= (candidate.warnings?.length || 0) * 25
  score -= (candidate.blockers?.length || 0) * 200
  if (candidate.evidence?.strap) score += 20
  if (candidate.evidence?.shell) score += 20
  if (candidate.receipt) score += 5
  return score
}

export function delayFor(stageId, options = {}) {
  const delays = options.delays || options.delay || {}
  if (typeof delays === 'number') return delays
  const value = delays[stageId] ?? delays[`${stageId}`] ?? options.delayMinutes ?? 0
  return asNumber(value, 0)
}

export function effectiveStageInterval(stage, options = {}) {
  const override = options.stageOverrides?.[stage.id] || options.scheduleOverrides?.[stage.id]
  let start = stage.start
  let end = stage.end
  if (override) {
    start = asNumber(override.start ?? override.from, start)
    end = asNumber(override.end ?? override.until ?? override.to, end)
  }
  const delay = delayFor(stage.id, options)
  const mode = options.delayMode || 'extend'
  if (delay) {
    if (mode === 'shift') {
      start += delay
      end += delay
    } else {
      end += delay
    }
  }
  return { start, end }
}

function assignmentKey(a) {
  return `${a.stage}|${a.athlete}|${a.mask}|${a.start}|${a.end}`
}

export function effectiveAssignmentInterval(assignment, stage, options = {}) {
  const overrideKey = options.assignmentKey?.(assignment) || `${assignment.stage}:${assignment.athlete}:${assignment.mask}`
  const override = options.assignmentOverrides?.[overrideKey] || options.assignmentOverrides?.[assignmentKey(assignment)]
  let start = assignment.start
  let end = assignment.end
  if (override) {
    start = asNumber(override.start ?? override.from, start)
    end = asNumber(override.end ?? override.until ?? override.to, end)
  }
  const delay = delayFor(assignment.stage, options)
  if (delay && options.extendAssignments !== false) {
    // 场次延时默认延长该场领用区间的右端；若业务提供了精确 assignmentOverrides，则以覆盖值为准。
    end += delay
  }
  return { start, end }
}

export function buildClaimIndex(snapshot) {
  const byId = new Map()
  for (const check of snapshot.source.checks) {
    if (!check.id) continue
    const existing = byId.get(check.id)
    if (!existing) byId.set(check.id, { ...check, sources: ['record'] })
    else existing.sources.push('record')
  }
  for (const batch of snapshot.provider.batches) {
    if (!batch.id) continue
    const base = byId.get(batch.id) || (batch.mask ? batch : normalizeCheck({ 0: batch.id }))
    const claim = {
      ...base,
      item: batch.item || base.item,
      result: batch.result || base.result,
      supersedes: batch.supersedes || base.supersedes,
      counter: batch.counter,
      seq: batch.seq,
      part: batch.part,
      sources: [...(base.sources || []), 'desk-batch']
    }
    byId.set(batch.id, claim)
  }

  const supersede = new Map()
  for (const rel of snapshot.source.supersessions) {
    if (rel.oldId && rel.newId) supersede.set(rel.oldId, rel.newId)
  }
  for (const batch of snapshot.provider.batches) {
    if (batch.supersedes && batch.id) supersede.set(batch.supersedes, batch.id)
  }
  const withdrawn = new Set(supersede.keys())
  const withdrawalItems = new Map()
  for (const [oldId, newId] of supersede) {
    const oldClaim = byId.get(oldId)
    const newClaim = byId.get(newId)
    const item = normItem(newClaim?.item && newClaim.item !== 'unknown'
      ? newClaim.item
      : oldClaim?.item)
    const items = new Set()
    if (item && item !== 'unknown' && item !== '*') items.add(item)
    else for (const one of ITEMS) items.add(one)
    withdrawalItems.set(oldId, items)
  }
  return { byId, supersede, withdrawn, withdrawalItems }
}

function receiptProofIndex(snapshot = { source: { receipts: [] } }) {
  const byArea = new Map()
  const all = new Set()
  for (const receipt of snapshot.source?.receipts || []) {
    byArea.set(receipt.area, receipt)
    for (const id of receipt.proofs) all.add(id)
  }
  return { byArea, all }
}

export function findEvidence(criteria, context = {}) {
  const {
    mask, weapon = '*', item, area, interval, snapshot, claimIndex, receiptIndex,
    includeWithdrawn = false
  } = criteria
  const index = claimIndex || buildClaimIndex(snapshot)
  const claims = index.byId
  const withdrawn = index.withdrawn
  const withdrawalItems = index.withdrawalItems
  const receipts = receiptIndex || receiptProofIndex(snapshot)
  const matches = []
  for (const claim of claims.values()) {
    if (normId(claim.mask) !== normId(mask)) continue
    if (item && claim.item !== '*' && claim.item !== normItem(item)) continue
    if (weapon && weapon !== '*' && claim.weapon !== '*' && normId(claim.weapon) !== normId(weapon)) continue
    if (!areasMatch(claim.area, area, context)) continue
    if (interval && !intervalCovers({ start: claim.start, end: claim.end }, interval)) continue
    const withdrawnItems = withdrawalItems?.get(claim.id)
    const soughtItem = item ? normItem(item) : null
    const isWithdrawn = withdrawn.has(claim.id) && (
      !soughtItem ||
      soughtItem === '*' ||
      !withdrawnItems ||
      withdrawnItems.has(soughtItem) ||
      // 同一凭据若本身是单项，撤回关系只可能作用于该项。
      (claim.item !== '*' && normItem(claim.item) === soughtItem)
    )
    if (isWithdrawn && !includeWithdrawn) continue
    const inAreaReceipt = Boolean(area && receipts.byArea.get(area)?.proofs.includes(claim.id))
    const inAnyReceipt = receipts.all.has(claim.id)
    const fromBatch = claim.sources?.includes('desk-batch')
    const score = [
      claim.result === 'pass' ? 1000 : 0,
      claim.area === area ? 100 : claim.area === '*' ? 50 : 10,
      inAreaReceipt ? 40 : 0,
      fromBatch ? 30 : 0,
      inAnyReceipt ? 20 : 0,
      claim.end !== null && interval?.end !== null ? Math.max(0, 20 - (claim.end - interval.end)) : 0,
      claim.start !== null && interval?.start !== null ? Math.max(0, 10 - (interval.start - claim.start)) : 0
    ].reduce((a, b) => a + b, 0)
    matches.push({
      claim,
      withdrawn: isWithdrawn,
      partiallyWithdrawn: withdrawn.has(claim.id) && !isWithdrawn,
      authoritative: inAreaReceipt || fromBatch || Boolean(claim.area === '*') || !receipts.all.size,
      crossDesk: !inAreaReceipt && (inAnyReceipt || fromBatch),
      receiptedElsewhere: !inAreaReceipt && inAnyReceipt,
      score
    })
  }
  matches.sort((a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id))
  return matches
}

function relevantAdverseClaims(criteria, context) {
  const found = findEvidence({ ...criteria, includeWithdrawn: true, interval: criteria.overlapInterval || criteria.interval }, context)
  return found.filter(m => {
    const c = m.claim
    if (m.withdrawn) return true
    if (c.result === 'fail') return true
    return false
  })
}

export function getReturnsMap(options = {}) {
  const map = new Map()
  for (const r of options.returns || options.returnReceipts || []) {
    if (typeof r === 'string') map.set(r, { returned: true, at: options.now ?? null, receipt: r })
    else if (r?.mask) map.set(r.mask, { returned: true, at: asNumber(r.at ?? r.returnedAt ?? r.time, options.now ?? null), receipt: r.receipt || r.id || null })
  }
  if (options.returnedMasks instanceof Set || Array.isArray(options.returnedMasks)) {
    for (const mask of options.returnedMasks) if (!map.has(mask)) map.set(mask, { returned: true, at: options.now ?? null })
  }
  return map
}

function findPassesForMask(passes, mask) {
  return passes.filter(p => p.mask === mask)
}

function passAppliesToCandidate(pass, candidate) {
  if (pass.mask !== candidate.mask) return false
  if (pass.stage && candidate.stage && pass.stage !== candidate.stage) {
    // 同面罩的通行证即使场次字段缺失/不同，也仍是面罩锁；这里只判断是否本人本场。
    return false
  }
  if (pass.athlete && candidate.athlete && pass.athlete !== candidate.athlete) return false
  return true
}

export function buildBoard(input = {}, rawOptions = {}) {
  const options = { ...rawOptions, ...(input.options || {}) }
  const snapshot = coerceSnapshot(input, options)
  const claimIndex = buildClaimIndex(snapshot)
  const receiptIndex = receiptProofIndex(snapshot)
  const returns = getReturnsMap(options)
  const now = asNumber(options.now ?? options.clock ?? snapshot.provider.now ?? snapshot.now, null)

  const stagesById = new Map(snapshot.source.stages.map(s => [s.id, s]))
  let stageFilter = options.stage || options.stageId || rawOptions.stage || null
  if (input.stage && typeof input.stage === 'string') stageFilter ||= input.stage

  const stageIds = stageFilter
    ? [stageFilter]
    : snapshot.source.stages.map(s => s.id)

  // 支持没有 stage 资料、只有 assignment 的调用。
  if (!stageFilter && stageIds.length === 0) {
    for (const a of snapshot.source.assignments) if (a.stage) stageIds.push(a.stage)
  }

  const boards = stageIds.map(stageId => {
    const stage = stagesById.get(stageId) || normalizeStage({ 0: stageId })
    const stageInterval = effectiveStageInterval(stage, options)
    const gate = designatedGateFor(stageId, null, null, options) || designatedGateFor(stage, null, null, options) || stage.gate || null
    const area = actualAreaFor(stage, gate, options)
    const deadline = asNumber(options.entryDeadline ?? options.deadline ?? stage.entryDeadline, stage.start)
    const deadlineInclusive = options.deadlineInclusive !== false
    const deadlineOpen = now === null || deadline === null
      ? null
      : deadlineInclusive ? now <= deadline : now < deadline

    const assignments = snapshot.source.assignments.filter(a => a.stage === stageId)
    const athletesMap = new Map()
    for (const assignment of assignments) {
      if (!athletesMap.has(assignment.athlete)) athletesMap.set(assignment.athlete, [])
      athletesMap.get(assignment.athlete).push(assignment)
    }

    const athleteBoards = [...athletesMap.entries()].map(([athlete, rows]) => {
      const designatedGate = designatedGateFor(stageId, athlete, null, options) || gate
      const candidateArea = actualAreaFor(stage, designatedGate, options) || area
      const candidates = rows.map(assignment => {
        const interval = effectiveAssignmentInterval(assignment, stage, options)
        const evidenceInterval = options.evidenceMode === 'assignment'
          ? interval
          : options.evidenceMode === 'remaining' && now !== null
            ? { start: Math.max(stageInterval.start ?? interval.start, now), end: stageInterval.end ?? interval.end }
            : stageInterval
        const evidenceArgs = {
          mask: assignment.mask,
          weapon: stage.weapon || assignment.weapon || '*',
          area: candidateArea,
          interval: evidenceInterval,
          snapshot,
          claimIndex,
          receiptIndex
        }
        const strapMatches = findEvidence({ ...evidenceArgs, item: 'strap' })
        const shellMatches = findEvidence({ ...evidenceArgs, item: 'shell' })
        const strap = strapMatches.find(m => m.claim.result === 'pass') || null
        const shell = shellMatches.find(m => m.claim.result === 'pass') || null
        const missing = []
        if (!strap) missing.push('strap')
        if (!shell) missing.push('shell')
        const adverse = relevantAdverseClaims({ ...evidenceArgs, overlapInterval: evidenceInterval })
          .filter(m => !m.withdrawn || missing.includes(m.claim.item) || true)
        // 已撤回凭据本身进入审计，但只有在没有替代合格证据时才构成阻断说明。
        const blockers = []
        const warnings = []
        if (!strap) blockers.push({ code: 'inspection_missing_strap', item: 'strap' })
        if (!shell) blockers.push({ code: 'inspection_missing_shell', item: 'shell' })
        const blockingFailures = adverse.filter(m => {
          const c = m.claim
          if (c.result !== 'fail') return false
          // 实际区域不匹配的外区失败只作警告。
          return areasMatch(c.area, candidateArea, options)
        })
        for (const failure of blockingFailures) {
          blockers.push({ code: `inspection_failed_${failure.claim.item}`, item: failure.claim.item, proof: failure.claim.id })
        }
        const foreignFailures = adverse.filter(m => m.claim.result === 'fail' && !areasMatch(m.claim.area, candidateArea, options))
        for (const f of foreignFailures) warnings.push({ code: 'foreign_failure_record', proof: f.claim.id, area: f.claim.area, item: f.claim.item })

        const overlaps = []
        for (const other of snapshot.source.assignments) {
          if (other.mask !== assignment.mask) continue
          if (other.athlete === assignment.athlete) continue
          const otherStage = stagesById.get(other.stage)
          const otherInterval = effectiveAssignmentInterval(other, otherStage, options)
          if (intervalsOverlap(interval, otherInterval)) {
            overlaps.push({ stage: other.stage, athlete: other.athlete, interval: otherInterval })
          }
        }
        if (overlaps.length) blockers.push({ code: 'assignment_overlap', conflicts: overlaps })

        const maskPasses = findPassesForMask(snapshot.provider.passes, assignment.mask)
        const ownPasses = maskPasses.filter(p => passAppliesToCandidate(p, { ...assignment, stage: stageId, athlete }))
        const activeEntered = maskPasses.filter(p => p.state === PASS_STATES.ENTERED)
        const returned = returns.get(assignment.mask)
        const enteredHolds = activeEntered.filter(() => {
          // 规则只优先保留“已进场且未交回”的面罩；一旦有交回记录，历史 entered 仍留在 passes/facts，
          // 但不再形成当前占用锁。
          return !returned?.returned
        })
        if (enteredHolds.length) blockers.push({ code: 'mask_held_by_entered_athlete', passes: enteredHolds.map(p => p.id), holders: enteredHolds.map(p => p.athlete) })

        const loadedPasses = maskPasses.filter(p => p.state === PASS_STATES.LOADED)
        const revokeRequests = options.revokeRequests || {}
        const loadedLocks = loadedPasses.map(p => {
          const own = Boolean(p.athlete) && p.athlete === athlete
          const sameGate = p.gate === designatedGate
          // 本人、本场、已在主管指定门 loaded 的单就是可过闸凭据；
          // 他人同面罩占用，或本人旧门凭据要转场，都必须先失效。
          const isCurrentUsable = own && sameGate && !options.forceRevoke
          return {
            pass: p,
            own,
            sameGate,
            currentUsable: isCurrentUsable,
            requiresRevocation: !isCurrentUsable,
            pending: Boolean(revokeRequests[p.id]?.requested || revokeRequests[p.id]?.status === 202)
          }
        })
        const actionableLocks = loadedLocks.filter(x => x.requiresRevocation)
        if (actionableLocks.some(x => !x.pending)) {
          blockers.push({ code: 'existing_loaded_pass_requires_revocation', passes: actionableLocks.filter(x => !x.pending).map(x => x.pass.id) })
        } else if (actionableLocks.some(x => x.pending)) {
          blockers.push({ code: 'waiting_old_gate_revocation_ack', passes: actionableLocks.map(x => x.pass.id) })
        }

        if (deadlineOpen === false) blockers.push({ code: 'entry_deadline_closed', deadline })
        if (interval.start !== null && stageInterval.start !== null && interval.start > stageInterval.start) {
          warnings.push({ code: 'loan_starts_after_stage_start', delay: interval.start - stageInterval.start, loanStart: interval.start, stageStart: stageInterval.start })
        }
        if (options.strictLoanDeadline && deadline !== null && interval.start !== null && interval.start > deadline) {
          blockers.push({ code: 'loan_starts_after_entry_deadline', deadline, loanStart: interval.start })
        }

        const printedPasses = maskPasses.filter(p => p.state === PASS_STATES.PRINTED)
        const revokedPasses = maskPasses.filter(p => p.state === PASS_STATES.REVOKED)
        const unknownPasses = maskPasses.filter(p => ![...Object.values(PASS_STATES)].includes(p.state))
        if (unknownPasses.length) blockers.push({ code: 'unknown_pass_state_manual', passes: unknownPasses.map(p => ({ id: p.id, state: p.state })) })

        const existingGatePass = ownPasses.find(p => p.state === PASS_STATES.LOADED && p.gate === designatedGate)
        const physicalPass = ownPasses.find(p => p.state === PASS_STATES.LOADED) || ownPasses.find(p => p.state === PASS_STATES.ENTERED) || null
        const readyToIssue = blockers.length === 0
        const canPassNow = Boolean(existingGatePass && !blockers.some(b =>
          b.code.startsWith('inspection_') ||
          b.code === 'mask_held_by_entered_athlete' ||
          b.code === 'assignment_overlap' ||
          b.code === 'entry_deadline_closed'
        ))
        const inspectionReady = missing.length === 0 && !blockers.some(b => b.code.startsWith('inspection_failed'))
        return {
          stage: stageId,
          athlete,
          mask: assignment.mask,
          allowed: readyToIssue,
          canIssue: readyToIssue,
          valid: inspectionReady,
          inspectionReady,
          assignmentInterval: interval,
          evidenceInterval,
          designatedGate,
          area: candidateArea,
          evidence: {
            strap: strap?.claim.id || null,
            shell: shell?.claim.id || null,
            proofs: [strap?.claim.id, shell?.claim.id].filter(Boolean),
            complete: missing.length === 0,
            details: { strap, shell },
            missing
          },
          blockers,
          warnings,
          overlaps,
          passes: maskPasses,
          ownPasses,
          loadedLocks,
          printedPasses,
          revokedPasses,
          enteredHolds,
          returned: returned || null,
          existingGatePass: existingGatePass || null,
          physicalGate: physicalPass?.gate || null,
          physicalPassState: physicalPass?.state || null,
          readyToIssue,
          canPassNow,
          reasons: blockers.map(blockerReason).filter(Boolean),
          actions: candidateActions({
            stageId, athlete, mask: assignment.mask, gate: designatedGate, candidateArea,
            missing, blockers, loadedLocks, printedPasses, existingGatePass, deadline, snapshot, options
          })
        }
      })

      const preferredMask = preferredMaskFor(stageId, athlete, options)
      const readyCandidates = candidates.filter(c => c.readyToIssue)
      readyCandidates.sort((a, b) => candidateRank(b, preferredMask) - candidateRank(a, preferredMask))
      const recommended = readyCandidates[0]
        || candidates
          .filter(c => !c.blockers.some(b => ['inspection_missing_strap', 'inspection_missing_shell', 'mask_held_by_entered_athlete', 'assignment_overlap', 'entry_deadline_closed'].includes(b.code) || b.code.startsWith('inspection_failed')))
          .sort((a, b) => candidateRank(b, preferredMask) - candidateRank(a, preferredMask))[0]
        || null

      let status = 'no_assignment'
      if (candidates.some(c => c.physicalPassState === PASS_STATES.ENTERED)) status = 'inside_mask_retained'
      else if (candidates.some(c => c.canPassNow)) status = 'can_pass_at_designated_gate'
      else if (recommended?.readyToIssue) status = 'ready_to_issue'
      else if (candidates.some(c => c.blockers.some(b => b.code === 'waiting_old_gate_revocation_ack'))) status = 'waiting_revocation_ack'
      else if (candidates.some(c => c.blockers.some(b => b.code === 'existing_loaded_pass_requires_revocation'))) status = 'revoke_required'
      else if (candidates.some(c => c.blockers.some(b => b.code.startsWith('inspection')))) status = 'inspection_needed'
      else if (candidates.some(c => c.blockers.some(b => b.code === 'mask_held_by_entered_athlete' || b.code === 'assignment_overlap'))) status = 'mask_occupied'
      else if (deadlineOpen === false) status = 'entry_closed'
      else status = 'manual_review'

      const manual = athleteManual({ stageId, athlete, candidates, recommended, deadline, area, weapon: stage.weapon })
      const needs = athleteNeeds({ stageId, athlete, candidates, recommended, deadline, area, weapon: stage.weapon })
      const byMask = Object.fromEntries(candidates.map(c => [c.mask, c]))
      const governanceActions = candidates
        .flatMap(c => c.actions || [])
        .filter(a => ['revoke', 'wait_for_revocation_ack'].includes(a.kind))
      const recommendedActions = recommended?.actions || []
      const actions = [...governanceActions, ...recommendedActions].filter(uniqueAction)
      return {
        stage: stageId,
        athlete,
        status,
        state: status,
        verdict: verdictFor(status),
        statusZh: STATUS_LABELS[status] || status,
        allowed: status === 'ready_to_issue' || status === 'can_pass_at_designated_gate',
        canIssue: status === 'ready_to_issue',
        designatedGate,
        area: actualAreaFor(stage, designatedGate, options) || area,
        recommendedMask: recommended?.mask || null,
        byMask,
        masks: candidates,
        canActuallyPassGate: candidates.find(c => c.physicalPassState === PASS_STATES.LOADED)?.physicalGate || null,
        enteredGate: candidates.find(c => c.physicalPassState === PASS_STATES.ENTERED)?.physicalGate || null,
        candidates,
        manual,
        needs,
        actions
      }
    })

    const allActions = athleteBoards.flatMap(a => a.actions).filter(uniqueAction)
    const manual = {
      inspection: athleteBoards.flatMap(a => a.manual.filter(m => m.kind === 'inspection')),
      passes: athleteBoards.flatMap(a => a.manual.filter(m => m.kind === 'pass')),
      equipment: athleteBoards.flatMap(a => a.manual.filter(m => m.kind === 'equipment'))
    }
    const stageAthletes = new Set(athleteBoards.map(a => a.athlete))
    const stageMasks = new Set(athleteBoards.flatMap(a => a.candidates.map(c => c.mask)))
    const holds = []
    for (const p of snapshot.provider.passes.filter(p => p.state === PASS_STATES.ENTERED)) {
      const relevant = stageAthletes.has(p.athlete) || stageMasks.has(p.mask)
      if (!relevant) continue
      const returned = returns.get(p.mask)
      if (!returned?.returned) holds.push({ kind: 'entered_unreturned_mask', retention: 'priority', retentionLabel: '优先暂留（已进场未交回）', mask: p.mask, athlete: p.athlete, pass: p.id, gate: p.gate, until: null })
    }
    for (const c of athleteBoards.flatMap(a => a.candidates)) {
      for (const lock of (c.loadedLocks || []).filter(x => x.requiresRevocation)) {
        holds.push({ kind: lock.pending ? 'loaded_pass_revocation_pending' : 'loaded_pass_requires_revocation', retention: 'temporary', retentionLabel: lock.pending ? '暂留：等待旧门确认失效' : '暂留：旧门 loaded 锁', mask: c.mask, pass: lock.pass.id, gate: lock.pass.gate, pending: lock.pending })
      }
    }
    const conflicts = athleteBoards.flatMap(a => a.candidates.flatMap(c => c.blockers.filter(b => b.code === 'assignment_overlap').map(b => ({ athlete: a.athlete, mask: c.mask, ...b }))))
    const passFacts = snapshot.provider.passes.filter(p =>
      (!p.stage || p.stage === stageId) &&
      ((p.athlete && stageAthletes.has(p.athlete)) || (p.mask && stageMasks.has(p.mask)))
    )
    const receiptFacts = snapshot.source.receipts.filter(r => !area || !r.area || r.area === area || r.area === '*')
    const byAthlete = Object.fromEntries(athleteBoards.map(a => [a.athlete, a]))
    return {
      stage: stageId,
      id: stageId,
      title: stageId,
      byAthlete,
      athletes: athleteBoards,
      status: stage.status,
      weapon: stage.weapon,
      area,
      gate,
      now,
      entryDeadline: deadline,
      deadlineOpen,
      interval: stageInterval,
      recommended: athleteBoards.map(a => ({ athlete: a.athlete, mask: a.recommendedMask, status: a.status, gate: a.designatedGate })),
      passFacts,
      receiptFacts,
      summary: {
        athletes: athleteBoards.length,
        canActuallyPass: athleteBoards.filter(a => a.canActuallyPassGate).length,
        readyToIssue: athleteBoards.filter(a => a.status === 'ready_to_issue').length,
        retained: holds.filter(h => h.retention === 'priority').length,
        temporaryHolds: holds.filter(h => h.retention === 'temporary').length,
        manualInspection: manual.inspection.length,
        manualPasses: manual.passes.length,
        borrowNeeds: manual.equipment.length
      },
      holds,
      conflicts,
      manual,
      actions: allActions
    }
  })

  if (stageFilter) return boards[0]
  const byStage = Object.fromEntries(boards.map(b => [b.stage, b]))
  return {
    edition: snapshot.source.edition,
    generatedAt: new Date().toISOString(),
    byStage,
    sessions: byStage,
    results: boards,
    summary: {
      stages: boards.length,
      athletes: boards.reduce((n, b) => n + b.athletes.length, 0),
      actions: boards.reduce((n, b) => n + b.actions.length, 0),
      manualInspection: boards.reduce((n, b) => n + b.manual.inspection.length, 0),
      manualPasses: boards.reduce((n, b) => n + b.manual.passes.length, 0),
      borrowNeeds: boards.reduce((n, b) => n + b.manual.equipment.length, 0)
    },
    stages: boards,
    actions: boards.flatMap(b => b.actions).filter(uniqueAction),
    manual: {
      inspection: boards.flatMap(b => b.manual.inspection),
      passes: boards.flatMap(b => b.manual.passes),
      equipment: boards.flatMap(b => b.manual.equipment)
    },
    holds: boards.flatMap(b => b.holds).filter((h, i, arr) => arr.findIndex(x => x.kind === h.kind && x.pass === h.pass && x.mask === h.mask) === i),
    facts: {
      passes: snapshot.provider.passes,
      receipts: snapshot.source.receipts,
      supersessions: snapshot.source.supersessions,
      inspectionBatches: snapshot.provider.batches
    }
  }
}

function candidateActions(ctx) {
  const actions = []
  for (const blocker of ctx.blockers) {
    if (blocker.code === 'existing_loaded_pass_requires_revocation') {
      for (const id of blocker.passes) {
        const lock = ctx.loadedLocks.find(x => x.pass.id === id)
        actions.push({
          id: stableId('revoke', [id]),
          kind: 'revoke',
          method: 'POST',
          endpoint: '/turnstile/revoke',
          body: { pass: id, gate: lock?.pass.gate },
          stage: ctx.stageId,
          athlete: ctx.athlete,
          mask: ctx.mask,
          reason: `旧门 ${lock?.pass.gate} 已接收通行证 ${id} 但未过闸；须先失效，才能在 ${ctx.gate} 重办同面罩通行证。`
        })
      }
    }
    if (blocker.code === 'waiting_old_gate_revocation_ack') {
      actions.push({
        id: stableId('wait', [ctx.mask, ...blocker.passes]),
        kind: 'wait_for_revocation_ack',
        stage: ctx.stageId,
        athlete: ctx.athlete,
        mask: ctx.mask,
        passes: blocker.passes,
        reason: '旧门仅返回 202/待处理；确认 revoked 前不能签发同面罩的新有效通行单。'
      })
    }
  }
  if (ctx.existingGatePass) {
    actions.push({
      id: stableId('cross', [ctx.existingGatePass.id]),
      kind: 'allow_cross',
      pass: ctx.existingGatePass.id,
      gate: ctx.gate,
      stage: ctx.stageId,
      athlete: ctx.athlete,
      mask: ctx.mask,
      reason: `通行证已被 ${ctx.gate} 门接收（loaded），可实际过闸。`
    })
  } else if (ctx.blockers.length === 0 && ctx.printedPasses.length) {
    actions.push({
      id: stableId('reissue', [ctx.stageId, ctx.athlete, ctx.mask, ctx.gate]),
      kind: 'reissue_printed_pass',
      method: 'POST',
      endpoint: '/turnstile/issue',
      body: { stage: ctx.stageId, athlete: ctx.athlete, mask: ctx.mask, gate: ctx.gate },
      replaces: ctx.printedPasses.map(p => p.id),
      stage: ctx.stageId,
      athlete: ctx.athlete,
      mask: ctx.mask,
      gate: ctx.gate,
      validUntil: ctx.deadline,
      reason: `旧单仅由发证台出单（printed），未被目标门接收；先查主管新指定的门 ${ctx.gate}，可在该门重办，有效至入场截止 ${ctx.deadline ?? '未指定'}。`
    })
  } else if (ctx.blockers.length === 0) {
    actions.push({
      id: stableId('issue', [ctx.stageId, ctx.athlete, ctx.mask, ctx.gate]),
      kind: 'issue',
      method: 'POST',
      endpoint: '/turnstile/issue',
      body: { stage: ctx.stageId, athlete: ctx.athlete, mask: ctx.mask, gate: ctx.gate },
      stage: ctx.stageId,
      athlete: ctx.athlete,
      mask: ctx.mask,
      gate: ctx.gate,
      validUntil: ctx.deadline,
      reason: `两项检查齐备且领用无冲突；签发 ${ctx.gate} 门临时通行单，有效至入场截止 ${ctx.deadline ?? '未指定'}。`
    })
  }
  return actions
}

function uniqueAction(action, index, arr) {
  return arr.findIndex(a => a.id === action.id) === index
}

function athleteManual({ stageId, athlete, candidates, deadline, area, weapon }) {
  const manual = []
  for (const c of candidates) {
    const missingItems = c.evidence.missing
    const failed = c.blockers.filter(b => b.code.startsWith('inspection_failed'))
    if (missingItems.length || failed.length) {
      const items = [...new Set([...missingItems, ...failed.map(f => f.item)])]
      manual.push({
        kind: 'inspection',
        type: 'reinspect',
        stage: stageId,
        athlete,
        mask: c.mask,
        area: c.area || area,
        weapon,
        items,
        interval: c.evidenceInterval,
        missing: missingItems,
        failedProofs: failed.map(f => f.proof).filter(Boolean),
        concreteRequest: `请裁判对 ${c.mask} 的${items.map(itemLabel).join('、')}发出覆盖区域 ${c.area || area || '实际区域'}、剑种 ${weapon}、时段 ${formatInterval(c.evidenceInterval)} 的新复检。`,
        reason: c.blockers.filter(b => b.code.startsWith('inspection')).map(b => b.code)
      })
    }
    for (const blocker of c.blockers.filter(b => b.code === 'existing_loaded_pass_requires_revocation' || b.code === 'waiting_old_gate_revocation_ack' || b.code === 'unknown_pass_state_manual')) {
      manual.push({
        kind: 'pass',
        type: blocker.code,
        stage: stageId,
        athlete,
        mask: c.mask,
        passes: blocker.passes,
        detail: blocker,
        concreteRequest: blocker.code === 'existing_loaded_pass_requires_revocation'
          ? `请旧门确认 ${blocker.passes?.join(', ')} 失效；确认前不得给 ${c.mask} 再发有效通行单。`
          : blocker.code === 'waiting_old_gate_revocation_ack'
            ? `等待旧门确认 ${blocker.passes?.join(', ')} 已 revoked，然后刷新闸机回执继续办理。`
            : `通行证状态异常，需要人工核对：${blocker.passes?.map(p => p.id + '=' + p.state).join(', ')}。`
      })
    }
  }
  const alreadyInside = candidates.some(c => c.enteredHolds.some(p => p.athlete === athlete))
  const hasOwnLoadedPass = candidates.some(c => c.loadedLocks.some(l => l.own))
  const hasUsableOrExistingPass = candidates.some(c => c.readyToIssue || c.existingGatePass)
  const hardBlocked = candidates.every(c => c.blockers.some(b =>
    b.code === 'mask_held_by_entered_athlete' ||
    b.code === 'assignment_overlap' ||
    b.code.startsWith('inspection')
  ))
  if (!hasUsableOrExistingPass && !alreadyInside && !hasOwnLoadedPass && hardBlocked) {
    const blockedMasks = candidates.map(c => c.mask)
    manual.push({
      kind: 'equipment',
      type: 'borrow_additional_mask',
      stage: stageId,
      athlete,
      masksConsidered: blockedMasks,
      deadline,
      concreteRequest: `没有可行换用面罩；请为 ${athlete}（场次 ${stageId}）补借一副可覆盖 ${area || '实际区域'} / ${weapon} / 入场截止 ${deadline ?? '未指定'} 的面罩，或完成上述复检。`
    })
  }
  return manual
}

function athleteNeeds(ctx) {
  return ctx.manual
}

export function formatReport(board) {
  const stages = board.stages || [board]
  const lines = []
  for (const stage of stages) {
    lines.push(`场次 ${stage.stage}（区域 ${stage.area || '-'}，主管门 ${stage.gate || '-'}，入场截止 ${stage.entryDeadline ?? '-'}）`)
    for (const a of stage.athletes || []) {
      lines.push(`- ${a.athlete}：${a.statusZh || a.status}；建议面罩 ${a.recommendedMask || '无'}；实际可过门 ${a.canActuallyPassGate || '暂无 loaded 单'}${a.enteredGate ? `；已从 ${a.enteredGate} 过闸` : ''}`)
      for (const c of a.candidates || []) {
        lines.push(`  · ${c.mask}：绑带 ${c.evidence.strap || '缺'}，外壳 ${c.evidence.shell || '缺'}；${c.readyToIssue ? '可签发' : '阻断=' + c.blockers.map(b => blockerReason(b)).join('；')}`)
      }
      for (const need of a.needs || []) lines.push(`  ! ${need.concreteRequest}`)
    }
    for (const hold of stage.holds || []) lines.push(`暂留：${hold.retentionLabel || hold.kind}，面罩 ${hold.mask}，单 ${hold.pass || '-'}，门 ${hold.gate || '-'}`)
  }
  const rootManual = board.manual
  if (board.stages && rootManual) {
    for (const item of rootManual.inspection || []) lines.push('人工复检：' + item.concreteRequest)
    for (const item of rootManual.passes || []) lines.push('通行证人工：' + item.concreteRequest)
    for (const item of rootManual.equipment || []) lines.push('补借：' + item.concreteRequest)
  }
  return lines.join('\n')
}

export function itemLabel(item) {
  return item === 'strap' ? '绑带' : item === 'shell' ? '外壳' : item
}

export function blockerReason(blocker) {
  switch (blocker.code) {
    case 'inspection_missing_strap': return '缺少覆盖实际区域、剑种和比赛时段的绑带合格证据。'
    case 'inspection_missing_shell': return '缺少覆盖实际区域、剑种和比赛时段的外壳合格证据。'
    case 'inspection_failed_strap': return '绑带新复检不合格，需要裁判处理。'
    case 'inspection_failed_shell': return '外壳新复检不合格，需要裁判处理。'
    case 'assignment_overlap': return '同一面罩在重叠时段签给了其他人。'
    case 'mask_held_by_entered_athlete': return '面罩已随选手过闸且尚未交回，优先保留，不能发给下一人。'
    case 'existing_loaded_pass_requires_revocation': return `旧门已接收通行证 ${blocker.passes?.join('、') || ''} 但未过闸；确认失效前不能再发同面罩有效单。`
    case 'waiting_old_gate_revocation_ack': return `等待旧门确认 ${blocker.passes?.join('、') || ''} 失效。`
    case 'entry_deadline_closed': return '已过该场次入场截止，临时通行单失效。'
    case 'unknown_pass_state_manual': return '既有通行证状态无法自动判断，需要人工处理。'
    default: return blocker.code
  }
}

export function formatInterval(interval) {
  if (!interval || interval.start === null || interval.end === null) return '未命名时段'
  return `[${interval.start},${interval.end})`
}

export function evaluateAthlete(...args) {
  let snapshot
  let selector = {}
  if (args[0] && (args[0].source || args[0].streams || args[0].editions || args[0].checks || args[0].provider)) {
    ;[snapshot, selector = {}] = args
  } else {
    const [stage, athlete, maybeSnapshot, options = {}] = args
    snapshot = maybeSnapshot
    selector = { ...options, stage, athlete }
  }
  const board = buildBoard(snapshot, selector)
  const athleteBoard = (board.athletes || board.stages?.flatMap(s => s.athletes) || [])
    .find(a => (!selector.athlete || a.athlete === selector.athlete))
  if (selector.mask && athleteBoard) {
    return { ...athleteBoard, candidate: athleteBoard.candidates.find(c => c.mask === selector.mask) || null }
  }
  return athleteBoard
}

export function canMaskPass(...args) {
  let snapshot, selector
  if (typeof args[0] === 'string') {
    const [mask, stage, maybeSnapshot, options = {}] = args
    snapshot = maybeSnapshot
    selector = { ...options, mask, stage }
  } else {
    ;[snapshot, selector = {}] = args
  }
  const result = evaluateAthlete(snapshot, selector)
  const candidate = result?.candidate || result?.candidates?.find(c => c.mask === selector.mask)
  return {
    allowed: Boolean(candidate?.canPassNow || candidate?.readyToIssue),
    canPassNow: Boolean(candidate?.canPassNow),
    canIssue: Boolean(candidate?.readyToIssue),
    gate: result?.designatedGate || candidate?.designatedGate || null,
    status: result?.status || 'not_found',
    result,
    candidate
  }
}

export const canMaskTransfer = canMaskPass

export function resolveEvidence(snapshot = {}, criteria = {}) {
  const snap = coerceSnapshot(snapshot, criteria)
  const claimIndex = buildClaimIndex(snap)
  const receiptIndex = receiptProofIndex(snap)
  const area = criteria.area ?? criteria.region ?? '*'
  const interval = criteria.interval ?? { start: criteria.start, end: criteria.end }
  const args = {
    mask: criteria.mask,
    weapon: criteria.weapon || '*',
    area,
    interval,
    snapshot: snap,
    claimIndex,
    receiptIndex
  }
  const pick = item => {
    const match = findEvidence({ ...args, item }).find(x => x.claim.result === 'pass')
    return match ? { id: match.claim.id, proof: match.claim.id, ...match } : null
  }
  const strap = pick('strap')
  const shell = pick('shell')
  const missing = []
  if (!strap) missing.push('strap')
  if (!shell) missing.push('shell')
  return {
    mask: criteria.mask,
    weapon: args.weapon,
    area,
    interval,
    strap: strap?.id || null,
    shell: shell?.id || null,
    strapEvidence: strap,
    shellEvidence: shell,
    missing,
    complete: missing.length === 0,
    ok: missing.length === 0
  }
}

export function nextAction(snapshot = {}, options = {}) {
  const board = buildBoard(snapshot, options)
  return board.actions?.[0] || board.stages?.flatMap(s => s.actions)[0] || null
}

export function planActions(snapshot = {}, options = {}) {
  const board = buildBoard(snapshot, options)
  return board.actions || board.stages?.flatMap(s => s.actions) || []
}

/**
 * 顶层便捷判断：某选手/面罩能否去指定门。
 * 支持 decide(snapshot, options) 或 decide(options)。
 */
export function decide(input = {}, maybeOptions = {}) {
  const options = typeof input === 'object' && !Array.isArray(input) && (input.checks || input.source || input.streams || input.provider || input.editions)
    ? maybeOptions
    : { ...input, ...maybeOptions }
  const snapshot = typeof input === 'object' && (input.checks || input.source || input.streams || input.provider || input.editions)
    ? input
    : {}
  const board = buildBoard(snapshot, options)
  if (options.stage || options.stageId) return board
  return board
}

export const evaluate = decide
export const analyze = decide
export const createDecision = decide
export const buildDecision = buildBoard
export const evaluateStage = buildBoard
export const createBoard = buildBoard
export const buildSupervisorBoard = buildBoard
export const judge = decide
export const reconcile = buildBoard
export const checkIn = decide
export const evaluateCheckin = decide
export const resolveCheckin = decide
