export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8004'

export const fetcher = (url: string) => fetch(url).then((r) => r.json())
