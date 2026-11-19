import type { Lote } from "../types";

export function isLotExpiredWithStock(
  lot: Pick<Lote, "cantidad" | "fechaVencimiento">,
  referenceDate = new Date()
): boolean {
  const quantity = Number(lot.cantidad || 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || !lot.fechaVencimiento) return false;

  const expirationDate = new Date(`${lot.fechaVencimiento}T00:00:00`);
  if (Number.isNaN(expirationDate.getTime())) return false;

  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);
  return expirationDate < today;
}
