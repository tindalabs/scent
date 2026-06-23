import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { RequireProject } from './components/RequireProject.js';
import { RequireOwner } from './components/RequireOwner.js';
import { Login } from './pages/Login.js';
import { AcceptInvite } from './pages/AcceptInvite.js';
import { Users } from './pages/Users.js';
import { Account } from './pages/Account.js';
import { Dashboard } from './pages/Dashboard.js';
import { IdentityList } from './pages/IdentityList.js';
import { IdentityDetail } from './pages/IdentityDetail.js';
import { DriftTimeline } from './pages/DriftTimeline.js';
import { ClusterDetail } from './pages/ClusterDetail.js';
import { AccountClusters } from './pages/AccountClusters.js';
import { Settings } from './pages/Settings.js';
import { Usage } from './pages/Usage.js';

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          {/* Admin/account pages don't need a selected project, so they sit outside
              the project gate. */}
          <Route path="settings" element={<Settings />} />
          <Route path="usage" element={<Usage />} />
          <Route path="account" element={<Account />} />
          <Route element={<RequireOwner />}>
            <Route path="users" element={<Users />} />
          </Route>
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
