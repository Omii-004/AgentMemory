import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PublicOnlyRoute } from '@/components/auth/PublicOnlyRoute';
import { MilestonePlaceholder } from '@/components/common/MilestonePlaceholder';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';

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
          <Route
            path="/dashboard"
            element={
              <MilestonePlaceholder
                title="Dashboard"
                description="Overview of your projects, benchmark experiments, and recent runs."
                milestone="Milestone F3"
              />
            }
          />
          <Route
            path="/projects"
            element={
              <MilestonePlaceholder
                title="Projects"
                description="Create and manage isolated research workspaces."
                milestone="Milestone F3"
              />
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              <MilestonePlaceholder
                title="Project Workspace"
                description="Namespaces, datasets, experiments, sessions, and settings."
                milestone="Milestone F3"
              />
            }
          />
          <Route
            path="/memory-lab"
            element={
              <MilestonePlaceholder
                title="Memory Lab"
                description="Configure, compare, store, retrieve, and consolidate memory architectures."
                milestone="Milestone F4"
              />
            }
          />
          <Route
            path="/memory-inspector"
            element={
              <MilestonePlaceholder
                title="Memory Inspector"
                description="Inspect stored memories, extracted facts, versions, and lifecycle events."
                milestone="Milestone F4"
              />
            }
          />
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