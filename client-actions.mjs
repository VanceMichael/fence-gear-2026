import { ProviderClient } from './client.mjs'

function asClient(clientOrUrl) {
  if (!clientOrUrl) return new ProviderClient(process.env.PROVIDER_URL || 'http://127.0.0.1:8701')
  if (typeof clientOrUrl === 'string') return new ProviderClient(clientOrUrl)
  return clientOrUrl
}

export async function revokePass(payload, clientOrUrl) {
  return asClient(clientOrUrl).revoke(payload)
}

export async function issuePass(payload, clientOrUrl) {
  return asClient(clientOrUrl).issue(payload)
}
