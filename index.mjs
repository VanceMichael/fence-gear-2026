export * from './core.mjs'
export * from './client.mjs'
export { Supervisor, createSupervisor } from './supervisor.mjs'
export { createServer, createHandler } from './server.mjs'
export { createServer as createApp } from './server.mjs'

import * as core from './core.mjs'
import * as client from './client.mjs'
import { Supervisor, createSupervisor } from './supervisor.mjs'
import { createServer, createHandler } from './server.mjs'

const api = {
  ...core,
  ...client,
  Supervisor,
  createSupervisor,
  createServer,
  createHandler,
  createApp: createServer
}

export const checkin = api
export const board = api
export const engine = core
export const createDesk = createSupervisor
export const createWorkflow = createSupervisor
export const createGate = createServer
export const createPassService = createSupervisor
export const supervisor = createSupervisor()
export const desk = supervisor
export const workflow = supervisor
export const app = createServer()
export default api
