import * as core from './core.mjs'

const board = (...args) => core.buildBoard(...args)
Object.assign(board, core)

export default board
export * from './index.mjs'
export { createServer as createBoardServer } from './index.mjs'
