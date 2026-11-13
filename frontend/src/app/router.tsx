import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PublicOnlyRoute } from '@/components/auth/PublicOnlyRoute';
import { MilestonePlaceholder } from '@/components/common/MilestonePlaceholder';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { MemoryInspectorPage } from '@/features/memory-inspector/MemoryInspectorPage';
import { MemoryLabPage } from '@/features/memory-lab/MemoryLabPage';
import { ProjectDetailPage } from '@/features/projects/ProjectDetailPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';

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
          <Route
            path="/benchmark-studio"
            element={
              <MilestonePlaceholder
                title="Benchmark Studio"
                description="Generate or import benchmark tasks and run multi-architecture evaluations."
                milestone="Milestone F5"
              />
            }
          />
          <Route
            path="/analytics"
            element={
              <MilestonePlaceholder
                title="Experiment Analytics"
                description="Compare metrics, 95% confidence intervals, failures, and execution traces."
                milestone="Milestone F6"
              />
            }
          />
          <Route
            path="/reports"
            element={
              <MilestonePlaceholder
                title="Reports"
                description="Generate and download machine-readable JSON and CSV evaluation reports."
                milestone="Milestone F6"
              />
            }
          />
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