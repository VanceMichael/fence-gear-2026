import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { Supervisor } from './supervisor.mjs'
import { buildBoard, formatReport } from './core.mjs'

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>检录主管看板</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;color:#172033;background:#f5f7fb}
body{margin:0}.wrap{max-width:1180px;margin:0 auto;padding:24px}
h1{margin:0 0 4px}.muted{color:#667085}.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:18px 0}
input,select,button,textarea{font:inherit;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}
button{cursor:pointer;background:#1d4ed8;color:#fff;border-color:#1d4ed8}
button.secondary{background:#fff;color:#1d4ed8}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.card{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:16px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
.row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border-top:1px solid #eef2f6;padding:10px 0}
.row:first-child{border-top:0}.pill{display:inline-flex;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:700;white-space:nowrap}
.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}.info{background:#dbeafe;color:#1e40af}.gray{background:#e5e7eb;color:#374151}
code{background:#f2f4f7;padding:1px 5px;border-radius:5px}
pre{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:10px;max-height:360px;overflow:auto}
ul{margin:6px 0 0 18px;padding:0}.small{font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
</style>
</head>
<body><div class="wrap">
  <h1>检录主管看板</h1>
  <div class="muted">合并区域后的面罩证据、领用占用、旧门回执与继续办理</div>
  <div class="bar">
    <label>场次 <input id="stage" placeholder="如 B1" /></label>
    <label>主管指定门 <input id="gate" placeholder="如 B" /></label>
    <label>当前时钟 <input id="now" type="number" placeholder="如 35" /></label>
    <button onclick="loadBoard()">刷新判断</button>
    <button class="secondary" onclick="refreshSources()">拉取来源/闸机</button>
    <button onclick="processQueue()">继续办理安全动作</button>
  </div>
  <div id="summary" class="bar muted"></div>
  <div id="board" class="grid"></div>
  <h2>人工处理与动作结果</h2>
  <div id="manual"></div>
  <pre id="json" aria-label="raw json"></pre>
</div>
<script>
let lastBoard=null;
function qs(){const s=document.getElementById('stage').value.trim();const g=document.getElementById('gate').value.trim();const n=document.getElementById('now').value;const p=new URLSearchParams();if(s)p.set('stage',s);if(g)p.set('gate',g);if(n)p.set('now',n);return p}
async function loadBoard(){const r=await fetch('/api/board?'+qs());lastBoard=await r.json();render(lastBoard)}
async function refreshSources(){await fetch('/api/refresh',{method:'POST'});await loadBoard()}
async function processQueue(){const body={};const s=document.getElementById('stage').value.trim();const g=document.getElementById('gate').value.trim();const n=document.getElementById('now').value;if(s)body.stage=s;if(g)body.gate=g;if(n)body.now=Number(n);const r=await fetch('/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});lastBoard=await r.json();document.getElementById('json').textContent=JSON.stringify(lastBoard,null,2);if(lastBoard.board)render(lastBoard.board)}
function pill(text,cls){return '<span class="pill '+cls+'">'+text+'</span>'}
function statusClass(s){if(/ready|can_pass/.test(s))return 'ok';if(/inside|waiting|revoke/.test(s))return 'warn';if(/needed|occupied|closed|manual/.test(s))return 'bad';return 'gray'}
function render(data){const b=data.stage?data:(data.stages||[])[0]||data;document.getElementById('json').textContent=JSON.stringify(data,null,2);
 const stages=data.stages||[data];document.getElementById('summary').textContent='资料版 '+(data.edition||b.edition||'-')+'；场次 '+stages.length;
 document.getElementById('board').innerHTML=stages.map(s=>'<section class="card"><h2>'+s.stage+' · '+(s.area||'')+' / 门 '+(s.gate||'-')+'</h2>'+(s.athletes||[]).map(a=>'<div class=row><div><strong>'+a.athlete+'</strong> '+pill(statusLabel(a.status),statusClass(a.status))+'<div class=small>建议面罩：<code>'+(a.recommendedMask||'无')+'</code>；实际可过：'+(a.canActuallyPassGate?'门 '+a.canActuallyPassGate:'暂无 loaded 单')+(a.enteredGate?'；已从 '+a.enteredGate+' 过闸':'')+'</div>'+renderCandidates(a)+renderNeeds(a)+'</div></div>').join('')+'</section>').join('');
 const manual=data.manual||b.manual||{inspection:[],passes:[],equipment:[]};document.getElementById('manual').innerHTML=['inspection','passes','equipment'].map(k=>(manual[k]||[]).map(x=>'<div class=card><strong>'+({inspection:'检查人工处理',passes:'通行证人工处理',equipment:'补借/换用'}[k])+'</strong><p>'+x.concreteRequest+'</p><pre>'+JSON.stringify(x,null,2)+'</pre></div>').join('')).join('') || '<p class=muted>暂无人工事项。</p>';
}
function renderCandidates(a){return '<ul class=small>'+a.candidates.map(c=>'<li><code>'+c.mask+'</code> 证据 绑带='+(c.evidence.strap||'缺')+' 外壳='+(c.evidence.shell||'缺')+'；'+(c.readyToIssue?'可签发':'阻断：'+c.blockers.map(x=>x.code).join(','))+'</li>').join('')+'</ul>'}
function renderNeeds(a){return (a.needs||[]).map(n=>'<div class="small warn">'+n.concreteRequest+'</div>').join('')}
function statusLabel(s){return ({ready_to_issue:'可发证',can_pass_at_designated_gate:'可过指定门',inside_mask_retained:'已进场/面罩暂留',waiting_revocation_ack:'等待旧门确认失效',revoke_required:'须先撤销旧单',inspection_needed:'需要复检',mask_occupied:'面罩占用中',entry_closed:'入场已截止',manual_review:'需人工判断'})[s]||s}
loadBoard();
</script>
</body></html>`

export function createServer(options = {}) {
  const supervisor = options.supervisor || new Supervisor(options)
  const handlerOptions = { autoRefresh: Boolean(options.sourceUrl || options.sourceClient), ...options }
  const handler = createHandler(supervisor, handlerOptions)
  const server = http.createServer(handler)
  server.supervisor = supervisor
  server.refresh = (...args) => supervisor.refresh(...args)
  server.board = (...args) => supervisor.board(...args)
  server.process = (...args) => supervisor.process(...args)
  return server
}

export function createHandler(supervisor, options = {}) {
  return async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      return response.end()
    }
    try {
      const url = new URL(request.url, 'http://localhost')
      const path = url.pathname.replace(/\/+$/, '') || '/'
      if (path === '/' || path === '/index.html') return sendHtml(response, HTML)
      if (path === '/health' || path === '/api/health') return sendJson(response, 200, { ok: true, service: 'checkin-supervisor' })

      if (request.method === 'GET' && ['/api/board', '/api/decide', '/board', '/decide', '/checkin', '/supervisor', '/api/stages', '/api/sessions'].includes(path)) {
        const refreshError = await maybeAutoRefresh(supervisor, options, url)
        const opts = queryOptions(url)
        const body = supervisor.board(opts.stage, opts)
        if (refreshError) body.refreshError = refreshError
        return sendJson(response, 200, body)
      }

      if (request.method === 'GET' && ['/report', '/api/report', '/api/report.txt'].includes(path)) {
        const refreshError = await maybeAutoRefresh(supervisor, options, url)
        const opts = queryOptions(url)
        const board = supervisor.board(opts.stage, opts)
        const report = formatReport(board) + (refreshError ? `\n来源刷新失败：${refreshError}\n` : '')
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        return response.end(report)
      }

      const stageMatch = /^\/api\/(?:stages|sessions)\/([^/]+)$/.exec(path)
      if (request.method === 'GET' && stageMatch) {
        const refreshError = await maybeAutoRefresh(supervisor, options, url)
        const opts = queryOptions(url)
        const body = supervisor.board(decodeURIComponent(stageMatch[1]), opts)
        if (refreshError) body.refreshError = refreshError
        return sendJson(response, 200, body)
      }

      if (request.method === 'POST' && ['/api/board', '/api/decide', '/api/evaluate'].includes(path)) {
        const body = await readBody(request)
        const data = body.snapshot ? buildBoard(body.snapshot, body.options || body) : buildBoard(body, body.options || {})
        return sendJson(response, 200, data)
      }

      if (request.method === 'POST' && ['/api/refresh', '/refresh'].includes(path)) {
        const result = await supervisor.refresh((await readBody(request).catch(() => ({}))) || {})
        return sendJson(response, 200, { ok: true, snapshot: result, board: supervisor.board() })
      }

      if (request.method === 'GET' && ['/api/gate', '/api/gates'].includes(path)) {
        return sendJson(response, 200, { designatedGates: supervisor.gateMap, defaultGate: supervisor.options.gate || null })
      }

      if (request.method === 'POST' && ['/api/gate', '/api/designated-gate', '/gate'].includes(path)) {
        const body = await readBody(request)
        const gate = supervisor.designateGate(body, body.gate)
        return sendJson(response, 200, { ok: true, gate, board: supervisor.board(body.stage) })
      }

      if (request.method === 'POST' && ['/api/return', '/api/returns', '/return'].includes(path)) {
        const body = await readBody(request)
        if (Array.isArray(body.returns)) body.returns.forEach(r => supervisor.recordReturn(r))
        else supervisor.recordReturn(body)
        return sendJson(response, 200, { ok: true, board: supervisor.board(body.stage) })
      }

      if (request.method === 'POST' && ['/api/delay', '/api/delays'].includes(path)) {
        const body = await readBody(request)
        supervisor.delayStage(body.stage || body.delays, body.minutes ?? body.delay)
        return sendJson(response, 200, { ok: true, board: supervisor.board(body.stage) })
      }

      if (request.method === 'POST' && ['/api/receipt', '/api/gate-receipt', '/webhook/turnstile', '/turnstile/receipt'].includes(path)) {
        const body = await readBody(request)
        const passes = supervisor.receiveGateReceipt(body.receipt || body.passes || body)
        const processResult = body.continue === false ? null : await supervisor.process({ ...(body.options || {}), refresh: false })
        return sendJson(response, 200, { ok: true, passes, result: processResult, board: supervisor.board(body.stage) })
      }

      if (request.method === 'POST' && ['/api/process', '/api/continue', '/process'].includes(path)) {
        const body = await readBody(request).catch(() => ({}))
        const result = await supervisor.process(body)
        return sendJson(response, 200, result)
      }

      if (request.method === 'POST' && ['/turnstile/revoke'].includes(path)) {
        const body = await readBody(request)
        if (supervisor.providerClient) {
          const result = await supervisor.providerClient.revoke(body)
          if (result.status === 202 || result.ok) {
            supervisor.revokeRequests[body.pass] = { requested: true, status: result.status, at: Date.now(), response: result.body }
          }
          return sendJson(response, result.status || 502, result.body || { ok: result.ok })
        }
        supervisor.revokeRequests[body.pass] = { requested: true, status: 202, at: Date.now() }
        return sendJson(response, 202, { state: 'received' })
      }

      if (request.method === 'POST' && ['/turnstile/issue'].includes(path)) {
        const body = await readBody(request)
        if (options.autoRefresh && supervisor.sourceClient && !supervisor.snapshot.source.checks.length) {
          await supervisor.refresh().catch(error => { supervisor.lastRefreshError = error.message })
        }
        const decision = issueDecision(supervisor, body)
        if (!decision.allowed) {
          return sendJson(response, 409, { error: '检录判断未通过，不能签发有效通行单', decision })
        }
        if (supervisor.providerClient) {
          const result = await supervisor.providerClient.issue({
            stage: body.stage,
            athlete: body.athlete,
            mask: body.mask,
            gate: body.gate
          })
          if (result.ok || result.status === 201 || result.status === 200 || result.status === 202) {
            supervisor.issuedPasses.push({ ...body, ...(result.body || {}) })
          }
          return sendJson(response, result.status || 502, result.body || { ok: result.ok })
        }
        return sendJson(response, 201, { pass: body.pass || 'LOCAL-' + Date.now(), state: 'printed', ...body, validUntil: decision.validUntil })
      }

      if (request.method === 'POST' && ['/api/revoke', '/revoke'].includes(path)) {
        const body = await readBody(request)
        if (!supervisor.providerClient) return sendJson(response, 400, { error: '未配置 providerUrl' })
        const result = await supervisor.providerClient.revoke(body)
        if (result.status === 202 || result.ok) {
          supervisor.revokeRequests[body.pass] = { requested: true, status: result.status, at: Date.now(), response: result.body }
        }
        return sendJson(response, result.status || 502, result.body || { ok: result.ok })
      }

      if (request.method === 'POST' && ['/api/issue', '/issue'].includes(path)) {
        const body = await readBody(request)
        if (!supervisor.providerClient) return sendJson(response, 400, { error: '未配置 providerUrl' })
        const result = await supervisor.providerClient.issue(body)
        return sendJson(response, result.status || 502, result.body || { ok: result.ok })
      }

      if (path.startsWith('/api/')) return sendJson(response, 404, { error: '没有该主管接口' })
      return sendText(response, 404, 'Not found')
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500
      return sendJson(response, status, { error: error.message, stack: process.env.NODE_ENV === 'test' ? error.stack : undefined })
    }
  }
}

async function maybeAutoRefresh(supervisor, options, url) {
  if (url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true') {
    try {
      await supervisor.refresh()
      return null
    } catch (error) {
      supervisor.lastRefreshError = error.message
      return error.message
    }
  }
  if (options.autoRefresh && supervisor.sourceClient && !supervisor.snapshot.source.checks.length) {
    try {
      await supervisor.refresh()
      supervisor.lastRefreshError = null
    } catch (error) {
      supervisor.lastRefreshError = error.message
      return error.message
    }
  }
  return null
}

function issueDecision(supervisor, body = {}) {
  const board = supervisor.board(body.stage, { ...body, now: body.now ?? supervisor.clock })
  const boards = board.stages || [board]
  let athleteBoard = null
  let candidate = null
  for (const stageBoard of boards) {
    for (const athlete of stageBoard.athletes || []) {
      if (body.athlete && athlete.athlete !== body.athlete) continue
      const found = (athlete.candidates || []).find(c =>
        (!body.mask || c.mask === body.mask) &&
        (!body.gate || c.designatedGate === body.gate || body.gate === undefined)
      )
      if (found) {
        athleteBoard = athlete
        candidate = found
        break
      }
    }
    if (candidate) break
  }
  if (!candidate) {
    return { allowed: false, reason: 'no_matching_assignment_or_mask', blockers: [{ code: 'candidate_not_found' }] }
  }
  const blockingCodes = new Set([
    'mask_held_by_entered_athlete',
    'assignment_overlap',
    'existing_loaded_pass_requires_revocation',
    'waiting_old_gate_revocation_ack',
    'entry_deadline_closed',
    'unknown_pass_state_manual'
  ])
  const hardBlockers = candidate.blockers.filter(b => blockingCodes.has(b.code) || b.code.startsWith('inspection_'))
  return {
    allowed: hardBlockers.length === 0,
    stage: candidate.stage,
    athlete: candidate.athlete,
    mask: candidate.mask,
    gate: candidate.designatedGate,
    validUntil: board.entryDeadline ?? null,
    recommendedMask: athleteBoard?.recommendedMask,
    blockers: hardBlockers,
    reasons: hardBlockers.map(b => b.code)
  }
}

function queryOptions(url) {
  const get = key => url.searchParams.get(key)
  const opts = {}
  for (const key of ['stage', 'stageId', 'athlete', 'mask', 'gate', 'actualArea', 'area', 'evidenceMode']) {
    if (get(key) !== null) opts[key] = get(key)
  }
  if (get('now') !== null) opts.now = Number(get('now'))
  if (get('delay') !== null) opts.delayMinutes = Number(get('delay'))
  if (get('strictLoanDeadline') === '1' || get('strictLoanDeadline') === 'true') opts.strictLoanDeadline = true
  if (get('designatedGate') !== null) opts.designatedGates = { [get('stage') || opts.stage]: get('designatedGate') }
  if (opts.gate) opts.designatedGates = { ...(opts.designatedGates || {}), [opts.stage || 'global']: opts.gate }
  return opts
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(body))
}

function sendHtml(response, body) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(body)
}

function sendText(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(body)
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cli = parseCliArgs(process.argv.slice(2))
  const port = Number(cli.port || process.env.PORT || process.env.SUPERVISOR_PORT || process.env.BOARD_PORT || 8702)
  const host = cli.host || process.env.HOST || '127.0.0.1'
  const server = createServer({
    sourceUrl: cli.sourceUrl || cli.source || process.env.SOURCE_URL || `http://127.0.0.1:${process.env.SOURCE_PORT || 8700}`,
    providerUrl: cli.providerUrl || cli.provider || process.env.PROVIDER_URL || `http://127.0.0.1:${process.env.PROVIDER_PORT || 8701}`,
    autoRefresh: true
  })
  server.listen(port, host, () => {
    console.log(`检录主管服务已启动: http://${host}:${server.address().port}`)
  })
}

function parseCliArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const body = arg.slice(2)
    if (body.includes('=')) {
      const [key, value] = body.split('=')
      result[camel(key)] = value
    } else {
      const key = body
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        result[camel(key)] = next
        i += 1
      } else {
        result[camel(key)] = true
      }
    }
  }
  return result
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}
