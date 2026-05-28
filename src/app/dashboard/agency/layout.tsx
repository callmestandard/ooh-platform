import DashboardLayout from '@/components/layout/DashboardLayout';

export default function AgencyLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>;
}