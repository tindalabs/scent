import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';

// Gate owner-only pages (e.g. account management). Non-owners are bounced to the
// dashboard. Assumes it sits inside ProtectedRoute, so `user` is already resolved.
export function RequireOwner(): React.ReactElement {
  const { user } = useAuth();
  if (user?.role !== 'owner') return <Navigate to="/" replace />;
  return <Outlet />;
}
