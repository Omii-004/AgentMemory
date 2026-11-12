import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { ApiClientError } from '@/services/api-client';
import { createProject } from '@/services/project.service';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ProjectResponse } from '@/types/api';

const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(200, 'Max 200 characters'),
  description: z.string().max(2000, 'Max 2000 characters').optional(),
});

type CreateProjectForm = z.infer<typeof createProjectSchema>;

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (project: ProjectResponse) => void;
}

export function CreateProjectModal({ open, onClose, onCreated }: CreateProjectModalProps) {
  const queryClient = useQueryClient();
  const { setActiveProjectId, pushToast } = useWorkspaceStore();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProjectForm>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: '', description: '' },
  });

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setActiveProjectId(project.id);
      pushToast({
        title: 'Project created',
        description: `"${project.name}" is now your active workspace.`,
        variant: 'success',
      });
      reset();
      setServerError(null);
      onClose();
      onCreated?.(project);
    },
    onError: (err) => {
      setServerError(err instanceof ApiClientError ? err.message : 'Failed to create project.');
    },
  });

  const onSubmit = (values: CreateProjectForm) => {
    setServerError(null);
    mutation.mutate({
      name: values.name,
      description: values.description?.trim() || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Research Project"
      description="Projects isolate memory namespaces, datasets, experiments, and reports."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
          >
            {serverError}
          </div>
        )}

        <div>
          <label htmlFor="project-name-input" className="block text-sm font-medium text-text-primary mb-1">
            Project name <span className="text-error">*</span>
          </label>
          <input
            id="project-name-input"
            type="text"
            placeholder="e.g., Long-Horizon Memory Study"
            className="w-full h-10 px-3 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('name')}
          />
          {errors.name && <p className="text-xs text-error mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor="project-desc-input" className="block text-sm font-medium text-text-primary mb-1">
            Description
          </label>
          <textarea
            id="project-desc-input"
            rows={3}
            placeholder="Optional research objective or notes"
            className="w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            {...register('description')}
          />
          {errors.description && (
            <p className="text-xs text-error mt-1">{errors.description.message}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={mutation.isPending}>
            Create Project
          </Button>
        </div>
      </form>
    </Modal>
  );
}