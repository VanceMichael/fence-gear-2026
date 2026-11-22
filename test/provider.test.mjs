import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { provider } from '../source/provider.mjs'

async function listen(t) {
  const source = provider().listen(0, '127.0.0.1')
  t.after(() => new Promise((resolve, reject) => source.close(error => error ? reject(error) : resolve())))
  await once(source, 'listening')
  return 'http://127.0.0.1:' + source.address().port
}

function post(root, endpoint, value) {
  return fetch(root + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value) })
}

test('复检只更正一项，旧门仍可拒绝刚办的新证', async t => {
  const root = await listen(t)
  const batch = await (await fetch(root + '/inspection/batch?counter=south&part=4')).json()
  assert.equal(batch[0].item, 'shell')
  assert.equal((await post(root, '/turnstile/revoke', { pass: 'PG1', gate: 'A' })).status, 202)
  assert.equal((await post(root, '/turnstile/issue', { gate: 'B', mask: 'M' })).status, 409)
  await post(root, '/lab?stage=acknowledged')
  const passes = await (await fetch(root + '/turnstile/passes')).json()
  assert.deepEqual(passes.map(pass => pass.state), ['revoked', 'entered'])
})
