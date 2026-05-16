// Removed ProtectedRoute for ease of access when testing
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
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/login" element={<Auth />} />
          <Route
            path="/onboarding"
            element={
              <Onboarding />
            }
          />

          <Route
            path="/home"
            element={
              <Home />
            }
          />
          <Route
            path="/track-health"
            element={
              <TrackHealth />
            }
          />
          <Route
            path="/sync-wearable"
            element={
              <SyncWearable />
            }
          />
          <Route
            path="/prepare"
            element={
              <Prepare />
            }
          />
        </Routes>
        <Chatbot />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
