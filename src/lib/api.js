const API_BASE = import.meta.env.VITE_API_BASE || ''

let _getToken = null
export function setTokenGetter(fn) { _getToken = fn }

async function authHeaders() {
  const token = _getToken ? await _getToken() : null
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

export async function api(path, options) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { 'content-type': 'application/json', ...(await authHeaders()), ...(options?.headers || {}) },
    ...options,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export const listArticles = (params = {}) => {
  const qs = new URLSearchParams(params)
  return api(`/articles?${qs}`)
}
export const getArticle = (id) => api(`/articles/${id}`)
export const updateArticle = (id, patch) => api(`/articles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const discover = () => api('/discover', { method: 'POST', body: '{}' })
export const fetchQueued = (limit = 30) => api('/fetch-queued', { method: 'POST', body: JSON.stringify({ limit }) })
export const health = () => api('/health')
export const getSyncedByHour = (hours = 24) => api(`/stats/synced-by-hour?hours=${hours}`)
export const getSyncedBySite = (limit = 500) => api(`/stats/synced-by-site?limit=${limit}`)
