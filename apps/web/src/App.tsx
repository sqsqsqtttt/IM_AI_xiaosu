import { Navigate, Route, Routes } from 'react-router';
import Layout from './components/Layout.tsx';
import Documents from './pages/Documents.tsx';
import DocViewer from './pages/DocViewer.tsx';
import Logs from './pages/Logs.tsx';
import Settings from './pages/Settings.tsx';
import Chat from './pages/Chat.tsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/documents" replace />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/documents/:id" element={<DocViewer />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="*" element={<Navigate to="/documents" replace />} />
      </Route>
    </Routes>
  );
}
