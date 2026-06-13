import { Link, Outlet } from 'react-router-dom';
import { useProjects } from '../contexts/ProjectContext.js';

// Gate the data pages on there being a selected project. Settings (key management)
// lives outside this gate so an operator with zero projects can still create one.
// Once a project exists, ProjectProvider guarantees activeId is set, so the data
// fetches always carry an X-Project-Id.
export function RequireProject(): React.ReactElement {
  const { projects, activeId, loading } = useProjects();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading projects…
      </div>
    );
  }

  if (projects.length === 0 || !activeId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">No projects yet.</p>
        <Link
          to="/settings"
          className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Create your first project
        </Link>
      </div>
    );
  }

  return <Outlet />;
}
