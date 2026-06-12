import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';

// Gate the whole Observatory behind an admin session. While the initial /admin/me
// check is in flight we render nothing meaningful; once resolved, unauthenticated
// users are sent to the login page.
export function ProtectedRoute(): React.ReactElement {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}
