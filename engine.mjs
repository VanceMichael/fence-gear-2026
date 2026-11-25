import * as core from './core.mjs'

const engine = (...args) => core.decide(...args)
Object.assign(engine, core)

export default engine
export * from './core.mjs'
