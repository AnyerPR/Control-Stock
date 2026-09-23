import { Producto } from "../types";

/**
 * Normaliza nombres de medicamentos y suministros eliminando acentos,
 * signos de puntuación innecesarios y espacios duplicados.
 */
export const normalizeSupplyName = (str?: string): string => {
  return String(str || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Quitar tildes / diacríticos
    .replace(/[\.,;:_\-\(\)\/\\\[\]\{\}#%*+]/g, " ") // Puntuación a espacios
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Normalización compacta (sin espacios) para detectar coincidencias tipo "500mg" vs "500 mg"
 */
export const normalizeCompactName = (str?: string): string => {
  return normalizeSupplyName(str).replace(/\s+/g, "");
};

/**
 * Detecta la letra inicial para generar el prefijo correlativo (ej: Paracetamol -> P, Guantes -> G)
 */
export const getInitialPrefix = (nameStr: string): string => {
  if (!nameStr) return "P";
  const normalized = nameStr.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const letterMatch = normalized.match(/[a-zA-Z]/);
  if (letterMatch) {
    return letterMatch[0].toUpperCase();
  }
  return "P";
};

/**
 * Genera el siguiente código correlativo consecutivo por prefijo (ej: P001, P002...)
 */
export const generateNextCodeConsecutive = (
  currentCatalogId: string,
  customPrefix: string = "P",
  listToUse: Producto[] = []
): string => {
  const prefix = (customPrefix || "P").toUpperCase();
  const numbers: number[] = [];

  listToUse.forEach((p) => {
    const regex = new RegExp(`^${prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}[^0-9]*(\\d+)`, "i");
    const match = p.codigo.trim().match(regex);
    if (match) numbers.push(parseInt(match[1], 10));
  });

  const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  let padLength = 3;
  const samePrefix = listToUse.filter((p) => p.codigo.trim().toUpperCase().startsWith(prefix));
  if (samePrefix.length > 0) {
    const digitMatch = samePrefix[0].codigo.match(/\d+/);
    if (digitMatch && digitMatch[0].length >= 3) padLength = digitMatch[0].length;
  }

  let finalCode = `${prefix}${String(nextNum).padStart(padLength, "0")}`;
  let inc = 1;
  while (listToUse.some((p) => p.codigo.trim().toUpperCase() === finalCode.toUpperCase())) {
    finalCode = `${prefix}${String(nextNum + inc).padStart(padLength, "0")}`;
    inc++;
  }
  return finalCode;
};

export interface MatchAnalysisResult {
  matchType: "existing_catalog" | "same_file_batch" | "new_product" | "manual_assigned";
  matchedProduct: Producto | null;
  matchedCatalogName?: string;
  matchedCatalogCode?: string;
  projectedCode: string;
  prefix: string;
  confidence: "exact" | "normalized" | "compact" | "new" | "manual";
  reason: string;
  isManualOverride?: boolean;
}

/**
 * Analiza un insumo contra el catálogo y contra los productos ya procesados en la misma tanda
 */
export const analyzeItemMatch = (
  itemNombre: string,
  itemDesc: string | undefined,
  initialCatalogProducts: Producto[],
  workingProducts: Producto[],
  activeCatalogId: string
): MatchAnalysisResult => {
  const cleanItem = normalizeSupplyName(itemNombre);
  const compactItem = normalizeCompactName(itemNombre);

  // 1. Buscar en la lista de trabajo actual
  const matchedProd = workingProducts.find((p) => {
    const catId = p.catalogId || "default-cat";
    if (catId !== activeCatalogId) return false;

    const pClean = normalizeSupplyName(p.nombre);
    if (pClean === cleanItem) return true;

    const pCompact = normalizeCompactName(p.nombre);
    if (pCompact === compactItem) return true;

    return false;
  });

  if (matchedProd) {
    // Determinar si ya existía en el catálogo previo o si fue añadido en esta misma tanda
    const isFromInitialCatalog = initialCatalogProducts.some((p) => p.codigo === matchedProd.codigo);
    const pClean = normalizeSupplyName(matchedProd.nombre);
    let confidence: "exact" | "normalized" | "compact" = "normalized";
    if (matchedProd.nombre.trim().toLowerCase() === itemNombre.trim().toLowerCase()) {
      confidence = "exact";
    } else if (normalizeCompactName(matchedProd.nombre) === compactItem) {
      confidence = "compact";
    }

    if (isFromInitialCatalog) {
      return {
        matchType: "existing_catalog",
        matchedProduct: matchedProd,
        matchedCatalogName: matchedProd.nombre,
        matchedCatalogCode: matchedProd.codigo,
        projectedCode: matchedProd.codigo,
        prefix: getInitialPrefix(matchedProd.nombre),
        confidence,
        reason: `Coincide con "${matchedProd.nombre}" (Código: ${matchedProd.codigo}) en el catálogo.`
      };
    } else {
      return {
        matchType: "same_file_batch",
        matchedProduct: matchedProd,
        matchedCatalogName: matchedProd.nombre,
        matchedCatalogCode: matchedProd.codigo,
        projectedCode: matchedProd.codigo,
        prefix: getInitialPrefix(matchedProd.nombre),
        confidence,
        reason: `Coincide con un renglón previo de este mismo archivo ("${matchedProd.nombre}"). Se agruparán bajo el código ${matchedProd.codigo}.`
      };
    }
  }

  // Si no se encontró coincidencia: Es un producto NUEVO
  const prefix = getInitialPrefix(itemNombre);
  const projectedCode = generateNextCodeConsecutive(activeCatalogId, prefix, workingProducts);

  return {
    matchType: "new_product",
    matchedProduct: null,
    projectedCode,
    prefix,
    confidence: "new",
    reason: `No se encontró coincidencia en el catálogo. Se registrará como nuevo con código ${projectedCode}.`
  };
};
