import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { MobileLayout } from './components/Layout';
import { useAuth } from './hooks/useAuth';

// Pages
import Home from './pages/Home';
import Training from './pages/Training';
import Result from './pages/Result';
import Profile from './pages/Profile';
import EditProfile from './pages/EditProfile';
import Support from './pages/Support';
import InquiryDetail from './pages/InquiryDetail';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import FindPassword from './pages/FindPassword';
import Ranking from './pages/Ranking';
import Report from './pages/Report';
import OrganizationReport from './pages/OrganizationReport';
import Record from './pages/Record';
import TrainingSetup from './pages/TrainingSetup';
import TrainingSessionPlay from './pages/TrainingSessionPlay';
import Splash from './pages/Splash';
import Device from './pages/Device';
import DeviceAdd from './pages/DeviceAdd';
import DeviceDetail from './pages/DeviceDetail';
import AdminLayout from './components/Admin/AdminLayout';
import AdminIndex from './pages/admin/AdminIndex';
import AdminUsers from './pages/admin/AdminUsers';
import AdminBanners from './pages/admin/AdminBanners';
import AdminReports from './pages/admin/AdminReports';
import AdminSupport from './pages/admin/AdminSupport';
import AdminTerms from './pages/admin/AdminTerms';

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

  if (isAuthenticated) {
    return children;
  }

  // 비로그인 상태: 스플래시 노출 여부에 따라 분기 (세션마다 스플래시)
  let hasSeenSplash = false;
  try {
    hasSeenSplash = sessionStorage.getItem('noilink_splash_seen') === 'true';
  } catch {
    hasSeenSplash = false;
  }
  
  return <Navigate to={hasSeenSplash ? '/login' : '/splash'} replace />;
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
        <div className="text-center">
          <div className="text-red-400 mb-4">관리자 권한이 필요합니다</div>
          <button
            onClick={() => window.location.href = '/login'}
            className="px-6 py-2 rounded-lg text-white"
            style={{ backgroundColor: '#AAED10', color: '#000000' }}
          >
            로그인 페이지로 이동
          </button>
        </div>
      </div>
    );
  }
  
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/splash" element={<Splash />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/find-password" element={<FindPassword />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminIndex />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminUsers />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/banners"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminBanners />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/reports"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminReports />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/support"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminSupport />
              </AdminLayout>
            </AdminRoute>
          }
        />
        <Route
          path="/admin/terms"
          element={
            <AdminRoute>
              <AdminLayout>
                <AdminTerms />
              </AdminLayout>
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
                  path="/training/setup/:mode"
                  element={
                    <ProtectedRoute>
                      <TrainingSetup />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/training/session"
                  element={
                    <ProtectedRoute>
                      <TrainingSessionPlay />
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
                  path="/support"
                  element={
                    <ProtectedRoute>
                      <Support />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/support/inquiry/:inquiryId"
                  element={
                    <ProtectedRoute>
                      <InquiryDetail />
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
                  path="/report/organization"
                  element={
                    <ProtectedRoute>
                      <OrganizationReport />
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
                <Route
                  path="/device"
                  element={
                    <ProtectedRoute>
                      <Device />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/device/add"
                  element={
                    <ProtectedRoute>
                      <DeviceAdd />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/device/:deviceId"
                  element={
                    <ProtectedRoute>
                      <DeviceDetail />
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
