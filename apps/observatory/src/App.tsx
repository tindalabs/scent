import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { RequireProject } from './components/RequireProject.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { IdentityList } from './pages/IdentityList.js';
import { IdentityDetail } from './pages/IdentityDetail.js';
import { DriftTimeline } from './pages/DriftTimeline.js';
import { ClusterDetail } from './pages/ClusterDetail.js';
import { AccountClusters } from './pages/AccountClusters.js';
import { Settings } from './pages/Settings.js';

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          {/* Key management stays reachable with zero projects, so it sits outside
              the project gate. */}
          <Route path="settings" element={<Settings />} />
          {/* Everything else needs a selected project to scope its data. */}
          <Route element={<RequireProject />}>
            <Route index element={<Dashboard />} />
            <Route path="identities" element={<IdentityList />} />
            <Route path="identities/:id" element={<IdentityDetail />} />
            <Route path="identities/:id/timeline" element={<DriftTimeline />} />
            <Route path="accounts" element={<AccountClusters />} />
            <Route path="clusters/:id" element={<ClusterDetail />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
