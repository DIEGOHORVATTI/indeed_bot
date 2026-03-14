import useSWR from 'swr'
import { alpha } from '@mui/material/styles'
import { Box, Card, CardContent, Grid, Typography, CircularProgress } from '@mui/material'
import { fetcher, API_URL } from '@/lib/api'
import { STATUS_LABELS } from '@/lib/status-labels'

type StatsResponse = { status: string; count: number }[]

const STATUS_COLORS: Record<string, string> = {
  discovered: '#919EAB',
  enriched: '#00B8D9',
  scored: '#8E33FF',
  tailored: '#8E33FF',
  ready: '#FFAB00',
  applying: '#FFAB00',
  applied: '#22C55E',
  failed: '#FF5630',
  skipped: '#919EAB',
}

export function StatsCards({ swrKey }: { swrKey?: string }) {
  const key = swrKey || `${API_URL}/api/jobs/stats`
  const { data: stats } = useSWR<StatsResponse>(key, fetcher, {
    refreshInterval: 5000,
  })

  if (!stats) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Carregando estatísticas...
        </Typography>
      </Box>
    )
  }

  return (
    <Grid container spacing={2}>
      {stats.map((s) => {
        const color = STATUS_COLORS[s.status] || '#919EAB'
        return (
          <Grid key={s.status} size={{ xs: 6, sm: 4, md: 3, lg: 'grow' }}>
            <Card
              sx={{
                bgcolor: alpha(color, 0.08),
                borderColor: alpha(color, 0.16),
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  bgcolor: alpha(color, 0.14),
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                <Typography variant="h4" sx={{ color, fontWeight: 700, lineHeight: 1 }}>
                  {s.count}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', mt: 0.5, display: 'block' }}
                >
                  {STATUS_LABELS[s.status] || s.status}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )
      })}
    </Grid>
  )
}
