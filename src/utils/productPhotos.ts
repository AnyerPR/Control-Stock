import type { Lote, Producto } from "../types";

export const MAX_PRODUCT_PHOTOS = 3;
export const MAX_PHOTO_DATA_URL_LENGTH = 120 * 1024;

export function getProductImages(product: Pick<Producto, "imagenes" | "imagen" | "imagenURL">): string[] {
  const savedImages = Array.isArray(product.imagenes) ? product.imagenes.filter(Boolean) : [];
  return savedImages.length > 0
    ? savedImages
    : [product.imagen || product.imagenURL].filter((image): image is string => !!image);
}

export function addProductImage(images: string[], image: string): string[] {
  if (images.length >= MAX_PRODUCT_PHOTOS) {
    throw new Error("Cada producto admite un máximo de 3 fotografías.");
  }
  return [...images, image];
}

export function replaceProductImage(images: string[], index: number, image: string): string[] {
  if (index < 0 || index >= images.length) {
    throw new Error("La fotografía seleccionada ya no está disponible.");
  }
  return images.map((current, currentIndex) => currentIndex === index ? image : current);
}

export function removeProductImage(images: string[], index: number): string[] {
  if (index < 0 || index >= images.length) {
    throw new Error("La fotografía seleccionada ya no está disponible.");
  }
  return images.filter((_, currentIndex) => currentIndex !== index);
}

export function createAdjustedLot(lot: Lote, checked: boolean): Lote {
  if (!checked) return { ...lot, articuloAjustado: false };

  const physicalQuantityValue = lot.cantidadF;
  const hasPhysicalQuantity = physicalQuantityValue !== null &&
    physicalQuantityValue !== undefined &&
    String(physicalQuantityValue).trim() !== "";
  const adjustedQuantity = Number(hasPhysicalQuantity ? physicalQuantityValue : lot.cantidad);
  if (!Number.isSafeInteger(adjustedQuantity) || adjustedQuantity < 0) {
    throw new Error("La cantidad física debe ser un número entero válido y no negativo.");
  }
  if (lot.fechaFisica) {
    const parsedDate = new Date(`${lot.fechaFisica}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lot.fechaFisica) ||
      Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== lot.fechaFisica) {
      throw new Error("La fecha física del lote no es válida.");
    }
  }

  return {
    ...lot,
    cantidad: adjustedQuantity,
    numeroLote: lot.loteFisico?.trim() || lot.numeroLote,
    fechaVencimiento: lot.fechaFisica || lot.fechaVencimiento,
    articuloAjustado: true
  };
}
