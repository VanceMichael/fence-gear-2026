import * as api from './index.mjs'
import { createSupervisor } from './supervisor.mjs'

const checkin = (options = {}) => createSupervisor(options)
Object.assign(checkin, api)
checkin.createCheckin = checkin
checkin.createCheckinServer = api.createServer

export default checkin
export * from './index.mjs'
export { createServer as createCheckinServer, createSupervisor as createCheckin } from './index.mjs'
