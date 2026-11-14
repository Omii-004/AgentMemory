import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PublicOnlyRoute } from '@/components/auth/PublicOnlyRoute';
import { AppShell } from '@/components/layout/AppShell';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { BenchmarkStudioPage } from '@/features/benchmark-studio/BenchmarkStudioPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { MemoryInspectorPage } from '@/features/memory-inspector/MemoryInspectorPage';
import { MemoryLabPage } from '@/features/memory-lab/MemoryLabPage';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/memory-lab" element={<MemoryLabPage />} />
          <Route path="/memory-inspector" element={<MemoryInspectorPage />} />
          <Route path="/benchmark-studio" element={<BenchmarkStudioPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}