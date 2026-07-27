import { ExamDashboard } from '@/app/_components/exam-dashboard'
import { UserDashboard } from '@/app/_components/user-dashboard'
import { AdminImpersonationPicker } from '@/app/_components/admin-impersonation-picker'

export default function DashboardPage() {
  return <><AdminImpersonationPicker /><ExamDashboard /><UserDashboard /></>
}
