import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __REACT_APP_MOUNTED__?: boolean;
    __repairMobilePWA?: (clearSession?: boolean) => Promise<void>;
  }
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: Readonly<ErrorBoundaryProps>;
  state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Error inesperado al iniciar la interfaz.'
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AppErrorBoundary caught an error:', error, errorInfo);
  }

  handleRepair = (clearSession: boolean) => {
    if (typeof window !== 'undefined' && typeof window.__repairMobilePWA === 'function') {
      window.__repairMobilePWA(clearSession);
    } else if (typeof window !== 'undefined') {
      if (clearSession) {
        try {
          localStorage.removeItem('current_user');
        } catch {}
      }
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-5 font-sans text-slate-800">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xl p-6 sm:p-8 max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-teal-50 border border-teal-200 p-2.5 flex items-center justify-center">
              <img
                src="./assets/aistudio/Logo_nuevo_b3fa17de.png"
                alt="Control de Stock"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Actualización de Aplicación Detectada
              </h2>
              <p className="text-xs font-medium text-slate-600 mt-1 leading-relaxed">
                Se detectó una versión en caché anterior en este dispositivo. Pulsa el botón inferior para sincronizar y abrir la aplicación.
              </p>
            </div>
            {this.state.errorMessage && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[11px] font-mono text-slate-500 break-words">
                {this.state.errorMessage}
              </div>
            )}
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => this.handleRepair(false)}
                className="w-full bg-teal-800 hover:bg-teal-700 active:scale-98 text-white font-extrabold text-xs uppercase tracking-wider py-3 px-4 rounded-xl shadow-sm transition cursor-pointer"
              >
                Reparar y Abrir Aplicación
              </button>
              <button
                type="button"
                onClick={() => this.handleRepair(true)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 px-4 rounded-xl transition cursor-pointer"
              >
                Reiniciar Sesión desde Cero
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

if (typeof window !== 'undefined') {
  window.__REACT_APP_MOUNTED__ = true;
}

if (
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  window.location.protocol !== 'file:'
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {
        // Silencioso en entornos restringidos
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
