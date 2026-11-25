import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { buildBoard, findEvidence, buildClaimIndex, coerceSnapshot, resolveEvidence } from '../core.mjs'
import { Supervisor } from '../supervisor.mjs'
import { createServer } from '../server.mjs'
import { createSource } from '../source/source.mjs'
import { provider as createProvider } from '../source/provider.mjs'

const sourceRecord = JSON.parse(await readFile(new URL('../records/source.json', import.meta.url), 'utf8'))
const providerRecord = JSON.parse(await readFile(new URL('../records/provider.json', import.meta.url), 'utf8'))

function scenarioSnapshot(stageName = 'merge') {
  const routeBody = predicate => providerRecord.stages[stageName].find(predicate)?.body
  const merge = providerRecord.stages[stageName]
  const batches = []
  for (const route of merge.filter(r => r.path === '/inspection/batch')) {
    batches.push({ counter: route.query.counter, part: Number(route.query.part), rows: route.body })
  }
  return {
    source: sourceRecord.editions.find(e => e.edition === 'r2'),
    provider: {
      counters: routeBody(r => r.path === '/inspection/counters'),
      batches,
      passes: routeBody(r => r.path === '/turnstile/passes')
    }
  }
}

test('T6 只撤回 T2 的 shell，T1 strap 仍然有效，T5 可补 B 区外壳', () => {
  const snapshot = scenarioSnapshot()
  const index = buildClaimIndex(coerceSnapshot(snapshot))
  assert.equal(index.supersede.get('T2'), 'T6')
  assert.ok(index.withdrawn.has('T2'))
  assert.equal(index.withdrawn.has('T1'), false)

  const strap = findEvidence({ mask: 'M', weapon: 'E', item: 'strap', area: 'B', interval: { start: 35, end: 55 }, claimIndex: index })[0]
  const shell = findEvidence({ mask: 'M', weapon: 'E', item: 'shell', area: 'B', interval: { start: 35, end: 55 }, claimIndex: index })[0]
  assert.equal(strap.claim.id, 'T1')
  assert.equal(shell.claim.id, 'T5')
  assert.equal(shell.crossDesk, true)

  const board = buildBoard(snapshot, { stage: 'B1', now: 30 })
  const p5 = board.athletes.find(a => a.athlete === 'P5')
  const m = p5.candidates.find(c => c.mask === 'M')
  assert.deepEqual(m.evidence.missing, [])
  assert.equal(m.evidence.strap, 'T1')
  assert.equal(m.evidence.shell, 'T5')
  assert.ok(m.blockers.some(b => b.code === 'existing_loaded_pass_requires_revocation' && b.passes.includes('PG1')))
})

test('P5 首选 M2；PG2/N 已进场形成优先暂留', () => {
  const board = buildBoard(scenarioSnapshot(), { now: 30 })
  const b1 = board.stages.find(s => s.stage === 'B1')
  const p5 = b1.athletes.find(a => a.athlete === 'P5')
  assert.equal(p5.recommendedMask, 'M2')
  assert.equal(p5.designatedGate, 'B')
  assert.ok(p5.candidates.find(c => c.mask === 'M2').readyToIssue)

  const a1 = board.stages.find(s => s.stage === 'A1')
  const p3 = a1.athletes.find(a => a.athlete === 'P3')
  assert.equal(p3.status, 'inside_mask_retained')
  assert.equal(p3.enteredGate, 'B')
  assert.ok(board.holds.some(h => h.kind === 'entered_unreturned_mask' && h.mask === 'N'))
})

test('延时使相邻领用区间重叠；交回后解除进场占用', () => {
  const snapshot = {
    source: {
      edition: 't',
      streams: {
        check: [
          ['C1', 'M', 'E', '*', 'strap', 0, 100, 'pass'],
          ['C2', 'M', 'E', '*', 'shell', 0, 100, 'pass']
        ],
        stage: [['S1', 'A', 'E', 0, 100, 'waiting']],
        assign: [
          ['S1', 'A1', 'M', 0, 10, 'R1'],
          ['S1', 'A2', 'M', 10, 20, '-']
        ]
      }
    },
    provider: { passes: [{ pass: 'PG9', athlete: 'A1', mask: 'M', gate: 'A', state: 'entered' }] }
  }
  let board = buildBoard(snapshot, { stage: 'S1' })
  let next = board.athletes.find(a => a.athlete === 'A2')
  assert.ok(next.candidates[0].blockers.some(b => b.code === 'mask_held_by_entered_athlete'))

  board = buildBoard(snapshot, { stage: 'S1', returns: [{ mask: 'M' }], delays: { S1: 5 } })
  next = board.athletes.find(a => a.athlete === 'A2')
  assert.ok(next.candidates[0].blockers.some(b => b.code === 'assignment_overlap'))
})

test('printed 单可按主管新门重办，loaded 异门单必须先撤销', () => {
  const snapshot = {
    source: {
      streams: {
        check: [['C1', 'M', 'E', '*', 'strap', 0, 100, 'pass'], ['C2', 'M', 'E', '*', 'shell', 0, 100, 'pass']],
        stage: [['S1', 'A', 'E', 10, 20, 'waiting']],
        assign: [['S1', 'P9', 'M', 10, 20, '-']]
      }
    },
    provider: {
      passes: [
        { pass: 'PP', athlete: 'P9', mask: 'M', gate: 'OLD', state: 'printed' },
        { pass: 'PL', athlete: 'P8', mask: 'L', gate: 'OLD', state: 'loaded' }
      ]
    }
  }
  let board = buildBoard(snapshot, { stage: 'S1', designatedGates: { S1: 'NEW' } })
  let p9 = board.athletes.find(a => a.athlete === 'P9')
  assert.equal(p9.recommendedMask, 'M')
  assert.equal(p9.actions.find(a => a.kind === 'reissue_printed_pass').body.gate, 'NEW')

  snapshot.source.streams.assign.push(['S1', 'P10', 'L', 10, 20, '-'])
  board = buildBoard(snapshot, { stage: 'S1', designatedGates: { S1: 'NEW' } })
  const p10 = board.athletes.find(a => a.athlete === 'P10')
  assert.ok(p10.actions.some(a => a.kind === 'revoke' && a.body.pass === 'PL' && a.body.gate === 'OLD'))
})

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}

test('主管服务串联来源、旧门 202、ack 后签发 M2', async t => {
  const source = createSource()
  const providerServer = createProvider()
  const sourceUrl = await listen(source)
  const providerUrl = await listen(providerServer)
  t.after(() => Promise.all([
    new Promise(resolve => source.close(resolve)),
    new Promise(resolve => providerServer.close(resolve))
  ]))

  const supervisor = new Supervisor({ sourceUrl, providerUrl, now: 30 })
  await supervisor.refresh()
  assert.equal(supervisor.snapshot.source.edition, 'r2')

  const first = await supervisor.process({ stage: 'B1', athlete: 'P5' })
  assert.deepEqual(first.revoked[0].body, { pass: 'PG1', gate: 'A' })
  assert.equal(first.issued.length, 0)

  const waiting = await supervisor.process({ stage: 'B1', athlete: 'P5' })
  assert.equal(waiting.issued.length, 0)
  assert.equal(waiting.skipped[0].reason, 'waiting_revocation_ack')

  await fetch(providerUrl + '/lab?stage=acknowledged', { method: 'POST' })
  await supervisor.refreshPasses()
  const done = await supervisor.process({ stage: 'B1', athlete: 'P5' })
  assert.equal(done.errors.length, 0)
  assert.equal(done.issued[0].response.pass, 'PG3')
  assert.deepEqual(done.issued[0].action.body, { stage: 'B1', athlete: 'P5', mask: 'M2', gate: 'B' })
})

test('同一综合凭据只更正外壳时，绑带合格不被连带撤回', () => {
  const snapshot = {
    source: {
      checks: [['C1', 'M', 'E', '*', '*', 0, 100, 'pass']],
      supersedes: [['C1', 'C2']]
    },
    provider: {
      batches: [{ id: 'C2', supersedes: 'C1', item: 'shell', result: 'fail', mask: 'M', weapon: 'E', area: '*', start: 0, end: 100 }]
    }
  }
  const evidence = resolveEvidence(snapshot, { mask: 'M', area: 'A', interval: { start: 1, end: 2 } })
  assert.equal(evidence.strap, 'C1')
  assert.equal(evidence.shell, null)
  assert.deepEqual(evidence.missing, ['shell'])
})

test('HTTP board endpoint returns supervisor JSON and UI', async t => {
  const supervisor = new Supervisor({ snapshot: scenarioSnapshot(), now: 30 })
  const server = createServer({ supervisor })
  const root = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const res = await fetch(root + '/api/board?stage=B1')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.athletes[0].recommendedMask, 'M2')
  const html = await fetch(root + '/')
  assert.match(await html.text(), /检录主管看板/)
})
