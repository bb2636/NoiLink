import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MobileLayout } from './components/Layout';
import { useAuth } from './hooks/useAuth';

// Pages
import Home from './pages/Home';
import Training from './pages/Training';
import Result from './pages/Result';
import Profile from './pages/Profile';
import EditProfile from './pages/EditProfile';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import FindPassword from './pages/FindPassword';
import Ranking from './pages/Ranking';
import Report from './pages/Report';
import Record from './pages/Record';
import Admin from './pages/Admin';

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">로딩 중...</div>
      </div>
    );
  }
  
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

// Admin Protected Route Component
function AdminRoute({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (user.userType !== 'ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-red-400">관리자 권한이 필요합니다</div>
      </div>
    );
  }
  
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/find-password" element={<FindPassword />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          }
        />
        <Route
          path="/*"
          element={
            <MobileLayout>
              <Routes>
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Home />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/training"
                  element={
                    <ProtectedRoute>
                      <Training />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/result"
                  element={
                    <ProtectedRoute>
                      <Result />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile/edit"
                  element={
                    <ProtectedRoute>
                      <EditProfile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/record"
                  element={
                    <ProtectedRoute>
                      <Record />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/ranking"
                  element={
                    <ProtectedRoute>
                      <Ranking />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/report/:reportId?"
                  element={
                    <ProtectedRoute>
                      <Report />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </MobileLayout>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
