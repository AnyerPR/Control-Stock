/**
 * Utilidad de persistencia automática de borradores (Draft Persistence)
 * Evita que el usuario pierda lo que estaba registrando o editando si sale
 * temporalmente de la aplicación (cambio de pestaña, bloqueo de pantalla en móvil,
 * uso de cámara/WhatsApp o recarga del navegador).
 */

export function loadDraft<T>(key: string, fallback: T): T {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    if (typeof fallback === "object" && !Array.isArray(fallback) && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed };
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Aviso guardando borrador local (${key}):`, err);
  }
}

export function clearDraft(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}
