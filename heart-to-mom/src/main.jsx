import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Auth from './pages/Auth.jsx'
import Home from './pages/Home.jsx'
import Onboarding from './pages/Onboarding.jsx'
import TrackHealth from './pages/TrackHealth.jsx'
import SyncWearable from './pages/SyncWearable.jsx'
import Prepare from './pages/Prepare.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import ProtectedRoute from './lib/ProtectedRoute.jsx'
import Chatbot from './components/Chatbot'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Auth />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/track-health"
            element={
              <ProtectedRoute>
                <TrackHealth />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sync-wearable"
            element={
              <ProtectedRoute>
                <SyncWearable />
              </ProtectedRoute>
            }
          />
          <Route
            path="/prepare"
            element={
              <ProtectedRoute>
                <Prepare />
              </ProtectedRoute>
            }
          />
        </Routes>
        <Chatbot />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
