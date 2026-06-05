import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { Dashboard } from './pages/Dashboard.js';
import { IdentityList } from './pages/IdentityList.js';
import { IdentityDetail } from './pages/IdentityDetail.js';
import { DriftTimeline } from './pages/DriftTimeline.js';
import { ClusterDetail } from './pages/ClusterDetail.js';
import { AccountClusters } from './pages/AccountClusters.js';

export function App(): React.ReactElement {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="identities" element={<IdentityList />} />
        <Route path="identities/:id" element={<IdentityDetail />} />
        <Route path="identities/:id/timeline" element={<DriftTimeline />} />
        <Route path="accounts" element={<AccountClusters />} />
        <Route path="clusters/:id" element={<ClusterDetail />} />
      </Route>
    </Routes>
  );
}
