import { spawn } from 'node:child_process'

const children = []
function run(script, env = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: new URL('.', import.meta.url).pathname,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
  children.push(child)
  return child
}

run('source/source.mjs', { PORT: process.env.SOURCE_PORT || '8700' })
run('source/provider.mjs', { PROVIDER_PORT: process.env.PROVIDER_PORT || '8701' })
const server = run('server.mjs', {
  PORT: process.env.PORT || '8702',
  SOURCE_URL: `http://127.0.0.1:${process.env.SOURCE_PORT || '8700'}`,
  PROVIDER_URL: `http://127.0.0.1:${process.env.PROVIDER_PORT || '8701'}`
})

function stop() {
  for (const child of children) child.kill('SIGTERM')
}
process.on('SIGINT', () => { stop(); process.exit(0) })
process.on('SIGTERM', () => { stop(); process.exit(0) })
server.on('exit', code => { stop(); process.exit(code ?? 0) })
