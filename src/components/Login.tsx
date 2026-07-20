import React, { useState } from "react";
import { Usuario } from "../types";
import { ShieldAlert, LoaderCircle, User, Key, Hospital } from "lucide-react";

interface LoginProps {
  users: Usuario[];
  isInitializingUsers: boolean;
  onLoginSuccess: (user: Usuario) => void;
}

// SHA-256 Utility Function
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function Login({ users, isInitializingUsers, onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError("Por favor complete todos los campos.");
      return;
    }

    setLoading(true);
    try {
      const foundUser = users.find(
        (u) => u.usuario.toLowerCase() === cleanUsername.toLowerCase()
      );

      if (!foundUser) {
        setError("Usuario no encontrado.");
        setLoading(false);
        return;
      }

      if (foundUser.estado === "Inactivo") {
        setError("Este usuario se encuentra inactivo. Contacte a un administrador.");
        setLoading(false);
        return;
      }

      const inputHash = await hashPassword(password);
      if (inputHash !== foundUser.contrasenaHash) {
        setError("Contraseña incorrecta.");
        setLoading(false);
        return;
      }

      onLoginSuccess(foundUser);
    } catch (err) {
      console.error(err);
      setError("Ocurrió un error al verificar las credenciales.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto h-16 w-16 bg-teal-800 rounded-3xl flex items-center justify-center shadow-md text-white mb-4">
          <Hospital className="w-9 h-9" />
        </div>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Control de Stock</h2>
        <p className="mt-1.5 text-sm font-semibold text-teal-700">
          Suministros Hospitalarios • Dr. José Manuel Rodríguez
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 border border-slate-200 shadow-md rounded-3xl sm:px-10">
          <h3 className="text-lg font-black text-slate-800 border-b border-slate-100 pb-3 mb-5">Iniciar Sesión</h3>

          {isInitializingUsers ? (
            <div className="flex flex-col items-center justify-center py-6 text-slate-400">
              <LoaderCircle className="w-8 h-8 animate-spin text-teal-600 mb-2" />
              <p className="text-xs font-semibold text-slate-500">Configurando usuarios del sistema...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 flex items-start gap-2.5 text-xs text-rose-800 font-semibold anim-card-in">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1.5">
                  Usuario
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Tu nombre de usuario"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 text-slate-800"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-teal-800 hover:bg-teal-700 disabled:bg-slate-300 text-white py-3 text-sm font-bold tracking-wide uppercase transition shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                    Iniciando...
                  </>
                ) : (
                  "Entrar al Sistema"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
export { hashPassword };
