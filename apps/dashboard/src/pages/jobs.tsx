import { JobTable } from '@/components/job-table'

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Vagas</h2>
      <JobTable />
    </div>
  )
}
