import Box from '@mui/material/Box'
import { JobTable } from '@/components/job-table'

export default function JobsPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <JobTable />
    </Box>
  )
}
