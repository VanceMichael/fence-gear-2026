#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { Supervisor } from './supervisor.mjs'
import { formatReport } from './core.mjs'

export async function main(argv = process.argv.slice(2)) {
  const args = new Map()
  const positional = []
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      args.set(key, value ?? true)
    } else {
      positional.push(arg)
    }
  }

  const supervisor = new Supervisor({
    sourceUrl: args.get('source') || process.env.SOURCE_URL || 'http://127.0.0.1:8700',
    providerUrl: args.get('provider') || process.env.PROVIDER_URL || 'http://127.0.0.1:8701',
    now: args.has('now') ? Number(args.get('now')) : undefined,
    gate: args.get('gate') || undefined,
    edition: args.get('edition') || process.env.SOURCE_EDITION || 'r2'
  })

  await supervisor.refresh()
  if (args.get('gate') && args.get('stage')) supervisor.designateGate(args.get('stage'), args.get('gate'))
  if (args.get('delay')) supervisor.delayStage(args.get('stage'), Number(args.get('delay')))

  if (args.get('process') !== undefined || args.get('do') !== undefined) {
    const result = await supervisor.process({ stage: args.get('stage'), athlete: args.get('athlete'), mask: args.get('mask') })
    console.log(JSON.stringify(result, null, 2))
  } else {
    const board = supervisor.board(args.get('stage'))
    console.log(args.has('json') ? JSON.stringify(board, null, 2) : formatReport(board))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
