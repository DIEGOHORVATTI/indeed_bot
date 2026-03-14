import { useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { Box, Typography, Stack } from '@mui/material'
import { API_URL } from '@/lib/api'
import { StatsCards } from '@/components/stats-cards'
import { ScrapeControls } from '@/components/scrape-controls'

const STATS_KEY = `${API_URL}/api/jobs/stats`

export default function OverviewPage() {
  const { mutate } = useSWRConfig()

  const handleScrapeComplete = useCallback(() => {
    mutate(STATS_KEY)
  }, [mutate])

  return (
    <Stack spacing={3}>
      <Typography variant="h4">Visão Geral</Typography>
      <StatsCards swrKey={STATS_KEY} />
      <ScrapeControls onComplete={handleScrapeComplete} />
    </Stack>
  )
}
