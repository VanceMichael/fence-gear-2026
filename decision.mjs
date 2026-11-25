import * as core from './core.mjs'

const decision = (...args) => core.decide(...args)
Object.assign(decision, core)

export default decision
export * from './core.mjs'
