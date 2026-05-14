export async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json', ...(options?.headers || {}) },
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
