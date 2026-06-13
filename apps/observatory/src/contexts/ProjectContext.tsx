import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { listProjects, setActiveProjectId, type AdminProject } from '../lib/api.js';
import { useAuth } from './AuthContext.js';

interface ProjectState {
  projects: AdminProject[];
  activeId: string | null;
  loading: boolean;
  setActive: (id: string) => void;
  refetch: () => Promise<void>;
}

const ProjectContext = createContext<ProjectState | undefined>(undefined);

// Remembers the operator's last selected project across reloads.
const STORAGE_KEY = 'scent.activeProjectId';

export function ProjectProvider({ children }: { children: ReactNode }): React.ReactElement {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Point the data client at a project and remember the choice. Invalidate cached
  // queries so every page refetches scoped to the new project (the query keys don't
  // carry the project id — switching projects swaps the whole dataset).
  const applyActive = useCallback(
    (id: string | null) => {
      setActiveId(id);
      setActiveProjectId(id);
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    },
    [],
  );

  const load = useCallback(async () => {
    const { projects: list } = await listProjects();
    setProjects(list);
    // Keep the stored selection if it still exists; otherwise fall back to the first.
    const stored = localStorage.getItem(STORAGE_KEY);
    const next = list.find((p) => p.id === stored)?.id ?? list[0]?.id ?? null;
    applyActive(next);
  }, [applyActive]);

  const setActive = useCallback(
    (id: string) => {
      if (id === activeId) return;
      applyActive(id);
      void queryClient.invalidateQueries();
    },
    [activeId, applyActive, queryClient],
  );

  // (Re)load the project list whenever the auth state flips. Clear it on logout so a
  // stale id never leaks into the next session.
  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setProjects([]);
      applyActive(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    load()
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          applyActive(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, load, applyActive]);

  return (
    <ProjectContext.Provider value={{ projects, activeId, loading, setActive, refetch: load }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider');
  return ctx;
}
