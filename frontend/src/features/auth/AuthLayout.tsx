import type { ReactNode } from 'react';
import { Database, GitCompare, ShieldCheck } from 'lucide-react';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas grid grid-cols-1 lg:grid-cols-12">
      {/* Left informational column */}
      <div className="hidden lg:flex lg:col-span-5 bg-sidebar text-white flex-col justify-between p-10">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center font-mono font-semibold text-sm">
              AM
            </div>
            <span className="text-lg font-semibold tracking-tight">AgentMemory</span>
          </div>
          <h1 className="text-2xl font-semibold mt-10 leading-snug">
            Long-Term Memory Research &amp; Benchmarking Platform
          </h1>
          <p className="text-sm text-gray-300 mt-3 leading-relaxed">
            Configure, test, and evaluate how AI agent memory architectures retain, retrieve,
            consolidate, and purge knowledge over controlled multi-turn benchmarks.
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex items-start gap-3">
              <Database className="h-4 w-4 text-primary shrink-0 mt-1" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Four Memory Architectures</p>
                <p className="text-xs text-gray-400">
                  Side-by-side comparison of History, Vector (pgvector), Structured S-P-O, and Hybrid ranking.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <GitCompare className="h-4 w-4 text-primary shrink-0 mt-1" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Statistical Evaluation &amp; Traces</p>
                <p className="text-xs text-gray-400">
                  TSR, Precision@K, Recall@K, MRR, 95% confidence intervals, paired significance, and execution traces.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-1" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">Tenant-Isolated Research Workspaces</p>
                <p className="text-xs text-gray-400">
                  Projects, datasets, memory namespaces, and benchmark runs are strictly scoped to your account.
                </p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400 font-mono">
          AgentMemory Research Workbench · v0.1
        </p>
      </div>

      {/* Right form column */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-surface border border-border rounded-lg p-7">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="h-7 w-7 rounded bg-primary text-white flex items-center justify-center font-mono text-xs font-semibold">
              AM
            </div>
            <span className="font-semibold text-text-primary">AgentMemory</span>
          </div>
          <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
          <p className="text-sm text-text-secondary mt-1">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}