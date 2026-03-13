'use client'

import { useEffect, useState, useRef } from 'react'

export function useSSE<T>(url: string): { data: T | null; connected: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('state', (event) => {
      try {
        setData(JSON.parse(event.data) as T)
      } catch {
        // ignore
      }
    })

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    return () => {
      es.close()
      esRef.current = null
    }
  }, [url])

  return { data, connected }
}
