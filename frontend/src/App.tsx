// frontend/src/App.tsx
// HashRouter 6화면. BrowserRouter 금지.

import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './ui';
import { ConnectScreen } from './screens/ConnectScreen';
import { JobScreen } from './screens/JobScreen';
import { TimelineScreen } from './screens/TimelineScreen';
import { KeywordsScreen } from './screens/KeywordsScreen';
import { ConfirmScreen } from './screens/ConfirmScreen';
import { SiteScreen } from './screens/SiteScreen';

export function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<ConnectScreen />} />
          <Route path="/s/:id/job/:jobId" element={<JobScreen />} />
          <Route path="/s/:id/timeline" element={<TimelineScreen />} />
          <Route path="/s/:id/keywords" element={<KeywordsScreen />} />
          <Route path="/s/:id/confirm" element={<ConfirmScreen />} />
          <Route path="/s/:id/site" element={<SiteScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
}
