import * as XLSX from "@keep-lts/xlsx";
import {
  DocumentoValidacionItem,
  MetodoExtraccionValidacion,
  Movimiento,
  Producto,
  RegistroConsumo,
  TipoDocumentoValidacion
} from "../types";
import { extractTableMatrixFromPdf } from "./pdfTableExtractor";

export interface RawExtractedDocItem {
  numeroItem: string;
  nombreProducto: string;
  unidadMedida: string;
  cantidad: number;
  costoUnitario?: number;
  fechaVencimiento?: string;
  lote?: string;
}

export interface DocumentExtractionOutput {
  tipoDocumento: TipoDocumentoValidacion;
  metodoExtraccion: MetodoExtraccionValidacion;
  rawItems: RawExtractedDocItem[];
  textoCrudo?: string;
  previewImageUrl?: string;
}

// Mapa de sinónimos farmacéuticos y unidades de medida para comparación inteligente
const PRESENTATION_SYNONYMS: Record<string, string> = {
  comp: "comprimido",
  compr: "comprimido",
  comprimidos: "comprimido",
  comprimido: "comprimido",
  tab: "comprimido",
  tabs: "comprimido",
  tableta: "comprimido",
  tabletas: "comprimido",
  cap: "capsula",
  caps: "capsula",
  capsula: "capsula",
  capsulas: "capsula",
  amp: "ampolla",
  amps: "ampolla",
  ampolla: "ampolla",
  ampollas: "ampolla",
  ampolleta: "ampolla",
  fco: "frasco",
  fcos: "frasco",
  frasco: "frasco",
  frascos: "frasco",
  vial: "vial",
  viales: "vial",
  jbe: "jarabe",
  jarabe: "jarabe",
  susp: "suspension",
  suspension: "suspension",
  sol: "solucion",
  solucion: "solucion",
  iny: "inyectable",
  inyectable: "inyectable",
  und: "unidad",
  unds: "unidad",
  unid: "unidad",
  unidad: "unidad",
  unidades: "unidad",
  pza: "unidad",
  pieza: "unidad",
  cja: "caja",
  caja: "caja",
  cajas: "caja",
  sob: "sobre",
  sobre: "sobre",
  sobres: "sobre",
  tub: "tubo",
  tubo: "tubo",
  crema: "crema",
  ung: "unguento",
  unguento: "unguento",
  pomada: "unguento",
  blister: "blister",
  gal: "galon",
  galon: "galon",
  rollo: "rollo",
  par: "par",
  kit: "kit",
  set: "set"
};

const PRESENTATION_SET = new Set(Object.keys(PRESENTATION_SYNONYMS));

const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "en",
  "con",
  "para",
  "por",
  "uso",
  "medico",
  "hospitalario"
]);

// Correcciones ortográficas y de OCR frecuentes en condujes y facturas médicas
const MEDICAL_OCR_CORRECTIONS: Record<string, string> = {
  solicion: "solucion",
  solucion: "solucion",
  toraxico: "toracico",
  toraxica: "toracica",
  pediatrica: "pediatrico",
  quirurgica: "quirurgico",
  esterilizado: "esteril",
  sabanitas: "sabanita",
  diclofenaco: "diclofenac"
};

export function normalizeTextBasic(val: string | undefined | null): string {
  const raw = String(val || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.%\/\-+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw
    .split(" ")
    .map((w) => MEDICAL_OCR_CORRECTIONS[w] || w)
    .join(" ");
}

/**
 * Extrae y estandariza concentraciones (ej: "500 mg" -> "500mg", "0.5 g" -> "500mg", "100 ml" -> "100ml", "1 l" -> "1000ml")
 */
export function extractNormalizedConcentrations(text: string): string[] {
  const norm = normalizeTextBasic(text);
  const regex = /\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|gr|ml|l|lt|lts|litro|litros|ui|iu|%|meq)(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*(ml|l|g|mg))?\b/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(norm)) !== null) {
    let val = parseFloat(match[1].replace(",", "."));
    let unit = match[2].toLowerCase();
    if (unit === "gr") unit = "g";
    if (unit === "ug") unit = "mcg";
    if (unit === "iu") unit = "ui";
    if (unit === "lt" || unit === "lts" || unit === "litro" || unit === "litros") unit = "l";
    // Convertir gramos pequeños a mg para comparar (ej. 0.5g === 500mg)
    if (unit === "g" && val > 0 && val <= 5) {
      val = Math.round(val * 1000);
      unit = "mg";
    }
    // Convertir litros pequeños a ml para comparar (ej. 1 L === 1000 ml)
    if (unit === "l" && val > 0 && val <= 10) {
      val = Math.round(val * 1000);
      unit = "ml";
    }
    const denomVal = match[3] ? match[3].replace(",", ".") : "";
    const denomUnit = match[4] ? match[4].toLowerCase() : "";
    const denom = denomUnit ? `/${denomVal}${denomUnit}` : "";
    results.push(`${val}${unit}${denom}`);
  }
  return results;
}

/**
 * Extrae formas farmacéuticas / unidades de medida normalizadas de un texto
 */
export function extractNormalizedPresentations(text: string): string[] {
  const norm = normalizeTextBasic(text);
  const words = norm.split(/[\s\/\-.,]+/).filter(Boolean);
  const found = new Set<string>();
  for (const w of words) {
    if (PRESENTATION_SYNONYMS[w]) {
      found.add(PRESENTATION_SYNONYMS[w]);
    }
  }
  return Array.from(found);
}

/**
 * Extrae los tokens base del principio activo / nombre del producto (sin concentraciones ni palabras de presentación)
 */
export function extractCoreNameTokens(text: string): string[] {
  const norm = normalizeTextBasic(text)
    // Unificar expresiones de concentración y empaque tipo C/100 o X 30 para removerlas del núcleo de palabras
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|gr|ml|l|lt|lts|litro|litros|ui|iu|%|meq)(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:ml|l|g|mg))?\b/gi, " ")
    .replace(/\b(?:c\/|x\s*)\d+\b/gi, " ");
  const rawWords = norm.split(/[\s\/\-.,]+/).filter(Boolean);
  const tokens: string[] = [];
  for (const w of rawWords) {
    if (w.length <= 1 && !/^\d+$/.test(w)) continue;
    if (STOP_WORDS.has(w)) continue;
    if (PRESENTATION_SET.has(w)) continue;
    tokens.push(w);
  }
  return tokens;
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : (maxLen - dp[m][n]) / maxLen;
}

export interface ProductMatchResult {
  producto: Producto | null;
  nivelCoincidencia: number; // 0 - 100
  razonCoincidencia: string;
}

/**
 * Compara inteligentemente un ítem extraído de un documento con el catálogo de productos del inventario.
 * Considera nombres, sinónimos con "/", principios activos, calibres, concentraciones (ej. 500 mg) y presentaciones.
 */
export function findBestInventoryMatch(
  rawItem: { nombreProducto: string; unidadMedida?: string; numeroItem?: string },
  inventoryProducts: Producto[]
): ProductMatchResult {
  if (!inventoryProducts || inventoryProducts.length === 0) {
    return { producto: null, nivelCoincidencia: 0, razonCoincidencia: "Inventario vacío" };
  }

  const docFullText = `${rawItem.nombreProducto || ""} ${rawItem.unidadMedida || ""}`.trim();
  const docNormName = normalizeTextBasic(rawItem.nombreProducto);
  const docCodeCandidate = normalizeTextBasic(rawItem.numeroItem).toUpperCase().replace(/\s+/g, "");

  // 1. Verificar si el número de ítem coincide exactamente con un código de producto
  if (docCodeCandidate && docCodeCandidate.length >= 2) {
    const exactCodeProd = inventoryProducts.find(
      (p) => p.codigo.trim().toUpperCase() === docCodeCandidate
    );
    if (exactCodeProd) {
      return {
        producto: exactCodeProd,
        nivelCoincidencia: 100,
        razonCoincidencia: "Código exacto en inventario"
      };
    }
  }

  const docCoreTokens = extractCoreNameTokens(rawItem.nombreProducto);
  const docSlashParts = String(rawItem.nombreProducto || "")
    .split("/")
    .map((p) => extractCoreNameTokens(p))
    .filter((arr) => arr.length > 0);
  const docTokenGroups = docSlashParts.length > 1 ? [docCoreTokens, ...docSlashParts] : [docCoreTokens];

  const docConcentrations = extractNormalizedConcentrations(docFullText);
  const docPresentations = extractNormalizedPresentations(docFullText);
  const docSizeNumbers = docCoreTokens.filter((t) => /^\d+$/.test(t));

  let bestProd: Producto | null = null;
  let bestScore = 0;
  let bestReason = "Sin coincidencia suficiente";

  for (const prod of inventoryProducts) {
    const invFullText = `${prod.nombre || ""} ${prod.descripcion || ""}`.trim();
    const invNormName = normalizeTextBasic(prod.nombre);

    // Coincidencia exacta de texto normalizado
    if (docNormName && docNormName === invNormName) {
      return {
        producto: prod,
        nivelCoincidencia: 100,
        razonCoincidencia: "Nombre exacto"
      };
    }

    const invCoreTokens = extractCoreNameTokens(invFullText);
    const invNameOnlyCoreTokens = extractCoreNameTokens(prod.nombre);
    const invConcentrations = extractNormalizedConcentrations(invFullText);
    const invPresentations = extractNormalizedPresentations(invFullText);
    const invSizeNumbers = invCoreTokens.filter((t) => /^\d+$/.test(t));

    if (docCoreTokens.length === 0 || invCoreTokens.length === 0) continue;

    // A. Similitud de principio activo / palabras clave del nombre (evaluando también partes separadas por "/" como "MOVIBLE DESECHABLE / SABANITA")
    let bestGroupCoverage = 0;
    let bestInvNameCoverage = 0;

    for (const groupTokens of docTokenGroups) {
      let matchedTokens = 0;
      for (const dTok of groupTokens) {
        let bestTokSim = 0;
        for (const iTok of invCoreTokens) {
          if (dTok === iTok) {
            bestTokSim = 1;
            break;
          }
          if (dTok.length >= 4 && iTok.length >= 4 && !/^\d+$/.test(dTok) && !/^\d+$/.test(iTok)) {
            if (iTok.startsWith(dTok) || dTok.startsWith(iTok)) {
              bestTokSim = Math.max(bestTokSim, 0.9);
            } else {
              const lSim = levenshteinSimilarity(dTok, iTok);
              if (lSim >= 0.78) bestTokSim = Math.max(bestTokSim, lSim);
            }
          }
        }
        matchedTokens += bestTokSim;
      }

      const gCov = matchedTokens / groupTokens.length;
      const iCov =
        invNameOnlyCoreTokens.length > 0
          ? Math.min(1, matchedTokens / invNameOnlyCoreTokens.length)
          : gCov;

      if (gCov * 0.6 + iCov * 0.4 > bestGroupCoverage * 0.6 + bestInvNameCoverage * 0.4) {
        bestGroupCoverage = gCov;
        bestInvNameCoverage = iCov;
      }
    }

    // Si ni el documento ni el nombre del inventario alcanzan cobertura mínima, descartar
    if (bestGroupCoverage < 0.45 && bestInvNameCoverage < 0.65) continue;

    let score = (bestGroupCoverage * 0.6 + bestInvNameCoverage * 0.4) * 72; // Base hasta 72 pts por principio activo
    const reasons: string[] = ["Nombre similar"];

    // B. Comparación de Calibre / Número de medida independiente (ej. "TUBO TORAXICO 12" vs "TUBO TORAXICO 24")
    if (docSizeNumbers.length > 0 && invSizeNumbers.length > 0) {
      const sizeMatch = docSizeNumbers.some((n) => invSizeNumbers.includes(n));
      if (sizeMatch) {
        score += 12;
        reasons.push(`Calibre/Medida (${docSizeNumbers[0]})`);
      } else {
        score -= 26;
        reasons.push("Calibre distinto");
      }
    }

    // C. Comparación de Concentración (ej. "500 mg" vs "500 mg comprimido", o "75mg" vs "75mg/3ml")
    if (docConcentrations.length > 0 && invConcentrations.length > 0) {
      const exactConcMatches = docConcentrations.filter((dc) => invConcentrations.includes(dc));
      const baseConcMatches = docConcentrations.filter((dc) => {
        const dcBase = dc.split("/")[0];
        return invConcentrations.some((ic) => ic === dc || ic.split("/")[0] === dcBase);
      });

      if (exactConcMatches.length > 0) {
        score += 20;
        reasons.push(`Concentración (${exactConcMatches[0]})`);
      } else if (baseConcMatches.length > 0) {
        score += 18;
        reasons.push(`Concentración (${baseConcMatches[0]})`);
      } else {
        score -= 22;
        reasons.push("Concentración distinta");
      }
    } else if (docConcentrations.length === 0 && invConcentrations.length === 0) {
      score += 12;
    } else {
      score += 8;
    }

    // D. Comparación de Presentación / Unidad de Medida (ej. "Comprimido", "Ampolla", "Frasco")
    if (docPresentations.length > 0 && invPresentations.length > 0) {
      const presMatch = docPresentations.some((dp) => invPresentations.includes(dp));
      if (presMatch) {
        score += 8;
        reasons.push(`Presentación (${docPresentations[0]})`);
      } else {
        score -= 6;
      }
    } else {
      if (bestGroupCoverage >= 0.9 || bestInvNameCoverage >= 0.9) {
        score += 6;
        if (invPresentations.length > 0) {
          reasons.push(`Sugerido (${invPresentations[0]})`);
        }
      }
    }

    const finalScore = Math.max(0, Math.min(99, Math.round(score)));
    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestProd = prod;
      bestReason = reasons.join(" • ");
    }
  }

  if (bestScore < 45) {
    return {
      producto: null,
      nivelCoincidencia: bestScore,
      razonCoincidencia: "Sin coincidencia en inventario"
    };
  }

  return {
    producto: bestProd,
    nivelCoincidencia: bestScore,
    razonCoincidencia: bestReason
  };
}

/**
 * Calcula las métricas de un producto en inventario (stock sistema, stock físico, consumo total, costo, vencimiento)
 */
export function computeInventoryMetricsForProduct(
  prod: Producto | null | undefined,
  movimientos: Movimiento[],
  consumos: RegistroConsumo[]
) {
  if (!prod) {
    return {
      existenciaSistemaActual: 0,
      existenciaFisicaActual: 0,
      consumoRegistradoTotal: 0,
      consumoMovimientosCount: 0,
      costoInventarioActual: undefined as number | undefined,
      fechaVencimientoInventarioActual: undefined as string | undefined,
      loteIdObjetivo: undefined as string | undefined,
      numeroLoteInventarioActual: undefined as string | undefined,
      unidadMedidaInventario: ""
    };
  }

  const lotes = Array.isArray(prod.lotes) ? prod.lotes : [];
  const existenciaSistemaActual = lotes.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
  const existenciaFisicaActual = lotes.reduce((acc, l) => acc + Number(l.cantidadF ?? l.cantidad ?? 0), 0);

  // Lote principal (con stock y vencimiento más próximo, o el primero disponible)
  const sortedLotes = [...lotes].sort((a, b) => {
    const aHas = Number(a.cantidad || 0) > 0 ? 1 : 0;
    const bHas = Number(b.cantidad || 0) > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return String(a.fechaVencimiento || "9999").localeCompare(String(b.fechaVencimiento || "9999"));
  });

  const primaryLot = sortedLotes[0];
  const costoInventarioActual = primaryLot ? Number(primaryLot.precio || 0) : undefined;
  const fechaVencimientoInventarioActual = primaryLot?.fechaVencimiento || undefined;

  // Calcular consumo del producto seleccionado (salidas en movimientos + registros en módulo Consumos sin duplicar)
  const movIdsFromConsumos = new Set<string>();
  let consumoFromModule = 0;
  let consumoCount = 0;

  for (const reg of consumos || []) {
    if (Array.isArray(reg.movimientoIds)) {
      reg.movimientoIds.forEach((id) => movIdsFromConsumos.add(id));
    }
    for (const it of reg.items || []) {
      if (it.productoCodigo === prod.codigo) {
        consumoFromModule += Number(it.cantidadEntregada || 0);
        consumoCount++;
      }
    }
  }

  let salidasAdicionales = 0;
  for (const mov of movimientos || []) {
    if (
      mov.productoCodigo === prod.codigo &&
      mov.tipoMovimiento === "Salida" &&
      !movIdsFromConsumos.has(mov.id) &&
      !mov.consumoId
    ) {
      salidasAdicionales += Math.abs(Number(mov.cantidad || 0));
      consumoCount++;
    }
  }

  const consumoRegistradoTotal = consumoFromModule + salidasAdicionales;

  const extractedPres = extractNormalizedPresentations(`${prod.descripcion || ""} ${prod.nombre || ""}`);
  const unidadMedidaInventario =
    prod.descripcion?.trim() ||
    (extractedPres.length > 0
      ? extractedPres[0].charAt(0).toUpperCase() + extractedPres[0].slice(1)
      : "Unidad");

  return {
    existenciaSistemaActual,
    existenciaFisicaActual,
    consumoRegistradoTotal,
    consumoMovimientosCount: consumoCount,
    costoInventarioActual,
    fechaVencimientoInventarioActual,
    loteIdObjetivo: primaryLot?.id,
    numeroLoteInventarioActual: primaryLot?.numeroLote,
    unidadMedidaInventario
  };
}

/**
 * Construye la lista comparativa DocumentoValidacionItem[] a partir de los ítems extraídos del documento
 */
export function buildValidationComparisonItems(
  rawItems: RawExtractedDocItem[],
  inventoryProducts: Producto[],
  movimientos: Movimiento[],
  consumos: RegistroConsumo[]
): DocumentoValidacionItem[] {
  return rawItems.map((raw, idx) => {
    const match = findBestInventoryMatch(raw, inventoryProducts);
    const matchedProd = match.producto;
    const metrics = computeInventoryMetricsForProduct(matchedProd, movimientos, consumos);

    const cantidadDoc = Number(raw.cantidad || 0);
    const diferenciaCantidad = matchedProd ? cantidadDoc - metrics.existenciaSistemaActual : cantidadDoc;
    const diferenciaFisica = matchedProd ? cantidadDoc - metrics.existenciaFisicaActual : cantidadDoc;

    const costDiffers =
      raw.costoUnitario !== undefined &&
      raw.costoUnitario > 0 &&
      metrics.costoInventarioActual !== undefined &&
      Math.abs(raw.costoUnitario - metrics.costoInventarioActual) >= 0.01;

    const dateDiffers =
      Boolean(raw.fechaVencimiento) &&
      Boolean(metrics.fechaVencimientoInventarioActual) &&
      raw.fechaVencimiento !== metrics.fechaVencimientoInventarioActual;

    const tieneDiscrepancia =
      !matchedProd || diferenciaCantidad !== 0 || Boolean(costDiffers) || Boolean(dateDiffers);

    return {
      id: `val-item-${Date.now()}-${idx}`,
      numeroItem: String(raw.numeroItem || idx + 1),
      nombreDocumento: String(raw.nombreProducto || "").trim(),
      unidadMedidaDocumento: String(raw.unidadMedida || "Unidad").trim(),
      cantidadDocumento: cantidadDoc,
      costoDocumento: raw.costoUnitario !== undefined && raw.costoUnitario > 0 ? Number(raw.costoUnitario) : undefined,
      fechaVencimientoDocumento: raw.fechaVencimiento || undefined,
      loteDocumento: raw.lote || undefined,
      productoCodigoSugerido: matchedProd?.codigo,
      productoNombreSugerido: matchedProd?.nombre,
      productoCodigoSeleccionado: matchedProd?.codigo || "",
      productoNombreInventario: matchedProd?.nombre,
      unidadMedidaInventario: metrics.unidadMedidaInventario,
      nivelCoincidencia: match.nivelCoincidencia,
      razonCoincidencia: match.razonCoincidencia,
      fueCorregidoManualmente: false,
      existenciaSistemaActual: metrics.existenciaSistemaActual,
      existenciaFisicaActual: metrics.existenciaFisicaActual,
      diferenciaCantidad,
      diferenciaFisica,
      consumoRegistradoTotal: metrics.consumoRegistradoTotal,
      consumoMovimientosCount: metrics.consumoMovimientosCount,
      costoInventarioActual: metrics.costoInventarioActual,
      fechaVencimientoInventarioActual: metrics.fechaVencimientoInventarioActual,
      loteIdObjetivo: metrics.loteIdObjetivo,
      numeroLoteInventarioActual: metrics.numeroLoteInventarioActual,
      tieneDiscrepancia
    };
  });
}

/**
 * Recalcula una fila de validación cuando el usuario cambia manualmente el código del producto o edita valores del documento
 */
export function recalculateValidationItemWithProduct(
  item: DocumentoValidacionItem,
  selectedProduct: Producto | null,
  movimientos: Movimiento[],
  consumos: RegistroConsumo[],
  isManualSelection = true
): DocumentoValidacionItem {
  const metrics = computeInventoryMetricsForProduct(selectedProduct, movimientos, consumos);
  const cantidadDoc = Number(item.cantidadDocumento || 0);
  const diferenciaCantidad = selectedProduct ? cantidadDoc - metrics.existenciaSistemaActual : cantidadDoc;
  const diferenciaFisica = selectedProduct ? cantidadDoc - metrics.existenciaFisicaActual : cantidadDoc;

  const costDiffers =
    item.costoDocumento !== undefined &&
    item.costoDocumento > 0 &&
    metrics.costoInventarioActual !== undefined &&
    Math.abs(item.costoDocumento - metrics.costoInventarioActual) >= 0.01;

  const dateDiffers =
    Boolean(item.fechaVencimientoDocumento) &&
    Boolean(metrics.fechaVencimientoInventarioActual) &&
    item.fechaVencimientoDocumento !== metrics.fechaVencimientoInventarioActual;

  const tieneDiscrepancia =
    !selectedProduct || diferenciaCantidad !== 0 || Boolean(costDiffers) || Boolean(dateDiffers);

  return {
    ...item,
    productoCodigoSeleccionado: selectedProduct?.codigo || "",
    productoNombreInventario: selectedProduct?.nombre,
    unidadMedidaInventario: metrics.unidadMedidaInventario,
    nivelCoincidencia: isManualSelection ? (selectedProduct ? 100 : 0) : item.nivelCoincidencia,
    razonCoincidencia: isManualSelection
      ? selectedProduct
        ? "Seleccionado manualmente por el usuario"
        : "Desvinculado manualmente"
      : item.razonCoincidencia,
    fueCorregidoManualmente: isManualSelection,
    existenciaSistemaActual: metrics.existenciaSistemaActual,
    existenciaFisicaActual: metrics.existenciaFisicaActual,
    diferenciaCantidad,
    diferenciaFisica,
    consumoRegistradoTotal: metrics.consumoRegistradoTotal,
    consumoMovimientosCount: metrics.consumoMovimientosCount,
    costoInventarioActual: metrics.costoInventarioActual,
    fechaVencimientoInventarioActual: metrics.fechaVencimientoInventarioActual,
    loteIdObjetivo: metrics.loteIdObjetivo,
    numeroLoteInventarioActual: metrics.numeroLoteInventarioActual,
    tieneDiscrepancia
  };
}

// ============================================================================
// PARSERS DE DOCUMENTOS: EXCEL, PDF, WORD (.DOCX/.DOC) E IMÁGENES (OCR + IA)
// ============================================================================

export function classifyValidationHeader(raw: any): string | null {
  const norm = normalizeTextBasic(String(raw ?? ""));
  if (!norm) return null;

  if (
    norm === "item" ||
    norm === "no" ||
    norm === "n" ||
    norm === "num" ||
    norm === "numero" ||
    norm === "no item" ||
    norm === "n de item" ||
    norm === "numero de item" ||
    norm === "renglon" ||
    norm === "codigo" ||
    norm === "cod"
  ) {
    return "item";
  }

  if (
    norm === "suministro" ||
    norm === "suministros" ||
    norm === "nombre" ||
    norm === "nombres" ||
    norm === "producto" ||
    norm === "productos" ||
    norm === "medicamento" ||
    norm === "medicamentos" ||
    norm === "articulo" ||
    norm === "articulos" ||
    norm === "insumo" ||
    norm === "insumos" ||
    norm.includes("nombre del producto") ||
    norm.includes("descripcion del producto")
  ) {
    return "name";
  }

  if (
    norm === "u de emision" ||
    norm === "u. de emision" ||
    norm === "unidad de emision" ||
    norm === "unidad de medida" ||
    norm === "u de medida" ||
    norm === "u.m." ||
    norm === "um" ||
    norm === "unidad" ||
    norm === "presentacion" ||
    norm === "forma farmaceutica"
  ) {
    return "unit";
  }

  if (norm === "descripcion" || norm === "detalle" || norm === "especificacion") {
    return "description";
  }

  if (
    norm === "n de lote" ||
    norm === "no de lote" ||
    norm === "numero de lote" ||
    norm === "lote" ||
    norm === "lote del producto"
  ) {
    return "lot";
  }

  if (
    norm === "fecha vto" ||
    norm === "fecha vto." ||
    norm === "fecha de vencimiento" ||
    norm === "fecha vencimiento" ||
    norm === "vencimiento" ||
    norm === "vence" ||
    norm === "exp" ||
    norm === "expira" ||
    norm === "fecha"
  ) {
    return "date";
  }

  if (
    norm === "cantidad" ||
    norm === "cant" ||
    norm === "cant." ||
    norm === "unidades" ||
    norm === "existencia" ||
    norm === "stock" ||
    norm === "conteo"
  ) {
    return "qty";
  }

  if (
    norm === "costo unit" ||
    norm === "costo unit." ||
    norm === "costo unitario" ||
    norm === "precio unitario" ||
    norm === "precio unit" ||
    norm === "precio" ||
    norm === "costo" ||
    norm === "valor unitario"
  ) {
    return "price";
  }

  return null;
}

export function normalizeValidationDate(rawVal: any): string {
  if (rawVal === undefined || rawVal === null || rawVal === "") return "";
  if (typeof rawVal === "number" && rawVal > 20000 && rawVal < 90000) {
    const utcDays = Math.floor(rawVal - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }
  const str = String(rawVal).trim();
  if (!str) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    let y = dmy[3];
    if (y.length === 2) y = `20${y}`;
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${y}-${m}-${d}`;
    }
    if (dNum >= 1 && dNum <= 12 && mNum >= 1 && mNum <= 31) {
      return `${y}-${d}-${m}`;
    }
  }

  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const monthMap: Record<string, string> = {
    ene: "01",
    jan: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    aug: "08",
    sep: "09",
    set: "09",
    oct: "10",
    nov: "11",
    dic: "12",
    dec: "12"
  };
  const mY = str.toLowerCase().match(/([a-z]{3})[a-z]*[\s\/\-]+(\d{2,4})/);
  if (mY && monthMap[mY[1]]) {
    let year = mY[2];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${monthMap[mY[1]]}-28`;
  }

  return "";
}

export function parseNumericValue(rawVal: any): number {
  if (typeof rawVal === "number") return isNaN(rawVal) ? 0 : rawVal;
  const str = String(rawVal ?? "")
    .replace(/RD\$|US\$|\$/gi, "")
    .trim();
  if (!str) return 0;

  let clean = str.replace(/\s+/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) {
    clean = clean.replace(/,/g, "");
  } else if (clean.includes(",") && !clean.includes(".")) {
    clean = clean.replace(",", ".");
  }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Convierte una matriz 2D (de Excel, PDF o tabla de Word) en RawExtractedDocItem[]
 */
export function parseMatrixToValidationItems(matrix: any[][]): RawExtractedDocItem[] {
  if (!matrix || matrix.length === 0) return [];

  let headerRowIdx = -1;
  let bestScore = 0;
  let colMap: Record<string, number> = {};

  for (let r = 0; r < Math.min(matrix.length, 35); r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const candidateMap: Record<string, number> = {};
    let score = 0;

    row.forEach((cell, cIdx) => {
      const cat = classifyValidationHeader(cell);
      if (cat && candidateMap[cat] === undefined) {
        candidateMap[cat] = cIdx;
        score += cat === "name" || cat === "qty" || cat === "description" ? 2 : 1;
      }
    });

    if (score > bestScore && (candidateMap.name !== undefined || candidateMap.description !== undefined)) {
      bestScore = score;
      headerRowIdx = r;
      colMap = candidateMap;
    }
  }

  const items: RawExtractedDocItem[] = [];

  if (headerRowIdx !== -1) {
    // Verificar si el nombre del producto está bajo la columna llamada "Descripción"
    let nameCol = colMap.name;
    let unitCol = colMap.unit;
    const descCol = colMap.description;

    if (nameCol === undefined && descCol !== undefined) {
      nameCol = descCol;
    } else if (nameCol !== undefined && descCol !== undefined) {
      // Inspeccionar primeras filas de datos por si "Suministro/Código" trae códigos cortos y "Descripción" trae el nombre del medicamento
      let nameLooksLikeCode = 0;
      let descLooksLikeProductName = 0;
      for (let r = headerRowIdx + 1; r < Math.min(matrix.length, headerRowIdx + 12); r++) {
        const row = matrix[r] || [];
        const vName = String(row[nameCol] ?? "").trim();
        const vDesc = String(row[descCol] ?? "").trim();
        if (vName && /^[A-Z0-9\-]{1,8}$/i.test(vName) && !/\s/.test(vName)) nameLooksLikeCode++;
        if (vDesc && vDesc.length >= 6 && /[a-zA-Z]{3,}/.test(vDesc)) descLooksLikeProductName++;
      }
      if (nameLooksLikeCode >= 2 && descLooksLikeProductName >= 2) {
        if (colMap.item === undefined) colMap.item = nameCol;
        nameCol = descCol;
      } else if (unitCol === undefined) {
        unitCol = descCol;
      }
    }

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (!Array.isArray(row) || row.every((c) => String(c ?? "").trim() === "")) continue;

      const rawName = nameCol !== undefined ? String(row[nameCol] ?? "").trim() : "";
      if (!rawName || rawName.length < 2) continue;
      if (/^(total|subtotal|pagina|página|firma|observaciones)\b/i.test(rawName)) continue;

      const rawItemNum =
        colMap.item !== undefined ? String(row[colMap.item] ?? "").trim() : String(items.length + 1);
      let rawUnit = unitCol !== undefined ? String(row[unitCol] ?? "").trim() : "";
      if (!rawUnit) {
        const detectedPres = extractNormalizedPresentations(rawName);
        rawUnit =
          detectedPres.length > 0
            ? detectedPres[0].charAt(0).toUpperCase() + detectedPres[0].slice(1)
            : "Unidad";
      }

      const qty = colMap.qty !== undefined ? parseNumericValue(row[colMap.qty]) : 0;
      const price = colMap.price !== undefined ? parseNumericValue(row[colMap.price]) : undefined;
      const dateStr = colMap.date !== undefined ? normalizeValidationDate(row[colMap.date]) : "";
      const lotStr = colMap.lot !== undefined ? String(row[colMap.lot] ?? "").trim() : "";

      items.push({
        numeroItem: rawItemNum || String(items.length + 1),
        nombreProducto: rawName,
        unidadMedida: rawUnit || "Unidad",
        cantidad: qty,
        costoUnitario: price && price > 0 ? price : undefined,
        fechaVencimiento: dateStr || undefined,
        lote: lotStr || undefined
      });
    }
  }

  // Fallback si la matriz no tenía encabezados estándar: analizar fila por fila
  if (items.length === 0) {
    const lines = matrix
      .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "").trim()).filter(Boolean).join(" | ") : ""))
      .filter(Boolean);
    return parseFreeTextLinesToItems(lines);
  }

  return items;
}

/**
 * Limpia artefactos de OCR en nombres de medicamentos o suministros (ej: "INOR-CREZINC" -> "NOR-CREZINC", "TUBOTORAXICO12" -> "TUBO TORAXICO 12")
 */
export function cleanOcrProductName(rawName: string, hadBorderArtifact = false): string {
  let s = String(rawName || "")
    // Remover bordes de tabla iniciales comunes en OCR (|, [, ], (, ), !, ¡)
    .replace(/^[\s|\[\]()!¡/\\:;.,\-+*•]+/, "")
    // Remover marcas de cotejo o asteriscos finales (*, =—, —, etc.)
    .replace(/[\s=—\-~_.,;*•|\/\\]+$/, "")
    .trim();

  // Si el OCR convirtió la línea vertical de la tabla "|" pegada a una letra mayúscula en "I" (ej. "INOR-CREZINC" o "ISOLICION")
  if (
    /^I[A-Z]{3,}\-[A-Z]{3,}/.test(s) ||
    (hadBorderArtifact && /^I[BCDFGHJKLMNPQRSTVWXYZ][A-Z]{2,}/.test(s))
  ) {
    s = s.slice(1).trim();
  }

  // Separar prefijos médicos comunes que el OCR haya pegado sin espacio (ej: "TUBOTORAXICO12" -> "TUBO TORAXICO 12")
  s = s
    .replace(/\b(TUBO|SOLUCION|SOLICION|CIRCUITO|CATETER|SONDA|JERINGA|GUANTE|MASCARILLA)([A-Z]{4,})/gi, "$1 $2")
    .replace(/([A-Z]{4,})(\d{1,3})\b/g, (full, word, num) => {
      // No separar si es vitamina como B12, D3, K1
      if (/^(VITAMINA|COMPLEJO|B|D|K)$/i.test(word)) return full;
      return `${word} ${num}`;
    });

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Detecta si una línea es metadato de encabezado de documento (RNC, Teléfono, Nombre Cliente, Dirección, Conduce, Fecha, etc.)
 */
function isDocumentMetadataOrNoiseLine(line: string): boolean {
  const norm = normalizeTextBasic(line);
  if (!norm || norm.length < 3) return true;

  // Líneas que son puramente separadores gráficos (—, _, ., ], |)
  const alphaCount = (line.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount < 3) return true;

  // Patrones de encabezado de condujes, facturas y actas dominicanas
  if (
    /^(impresion|fecha\s+impresion|numero\s+conduce|no\s+conduce|conduce\b|factura\b|tienda\b|nombre\s+cliente|cliente\s+rnc|telefono\s+cliente|direccion\s+cliente|atencion\b|direccion\b|ciudad\b|telefono\b|rnc\b|rc\b|nota\b|autopista\b|calle\b|ave\b|avenida\b|hospital\s+dr|nombre\s+menes|productos\s+farmaceuticos)/i.test(
      norm
    )
  ) {
    return true;
  }

  if (
    /\b(importadora\s+medica|baruc\s+pharma|numero\s+conduce|cliente\s+rnc|santo\s+domingo|distrito\s+nacional|los\s+alcarrizos|ens\s+la\s+fe|camscanner|despachado\s+por|despachedo\s+por|recibido\s+por|recibido\s+conforme|entregado\s+por|entregago)\b/i.test(
      norm
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Detecta si una línea marca el final de la tabla de productos (Totales, Comentarios, Firmas, Sellos)
 */
function isTableFooterOrStopLine(line: string): { isStop: boolean; totalUnits?: number } {
  const norm = normalizeTextBasic(line);

  // Detectar "Total Unidades Despachadas: 275.00" o "Total Unidades: 275"
  const totalUnitsMatch = line.match(
    /total\s+(?:de\s+)?unidades(?:\s+despachadas)?\s*[:.]?\s*(\d+(?:[.,]\d+)?)/i
  );
  if (totalUnitsMatch) {
    return {
      isStop: true,
      totalUnits: parseNumericValue(totalUnitsMatch[1])
    };
  }

  if (
    /^(total\s+unidades|total\s+despachad|total\s+general|sub\s*total|comentarios|observaciones|despachado\s+por|despachedo\s+por|recibido\s+por|recibido\s+conforme|entregado\s+por|entregago|escaneado\s+con\s+camscanner|cs\s+escaneado)\b/i.test(
      norm
    )
  ) {
    return { isStop: true };
  }

  return { isStop: false };
}

/**
 * Detecta si una línea es el encabezado de columnas de la tabla (ej. "Descripción Cantidad" o "[cantidad | espe | Predio unitario] Tot")
 * y devuelve el orden de columnas ("NAME_FIRST" o "QTY_FIRST").
 */
function detectTableHeaderLine(line: string): "NAME_FIRST" | "QTY_FIRST" | null {
  const norm = normalizeTextBasic(line);
  if (!norm) return null;

  const hasQty = /\b(cantidad|cant)\b/.test(norm);
  const hasDescOrName = /\b(descripcion|descrip|suministro|producto|medicamento|articulo|detalle|espe)\b/.test(norm);
  const hasPriceOrTot = /\b(precio|predio|unitario|costo|valor|total|tot)\b/.test(norm);

  if (hasQty && (hasDescOrName || hasPriceOrTot)) {
    const qtyIdx = norm.search(/\b(cantidad|cant)\b/);
    const descIdx = hasDescOrName
      ? norm.search(/\b(descripcion|descrip|suministro|producto|medicamento|articulo|detalle|espe)\b/)
      : 999;
    const priceIdx = hasPriceOrTot
      ? norm.search(/\b(precio|predio|unitario|costo|valor|total|tot)\b/)
      : 999;

    if (qtyIdx >= 0 && (qtyIdx < descIdx || (!hasDescOrName && qtyIdx < priceIdx))) {
      return "QTY_FIRST";
    }
    return "NAME_FIRST";
  }

  // Verificar por tokens clasificados
  const tokens = line.split(/[\s|;,\t\[\]]+/).filter(Boolean);
  const cats = tokens.map((t) => classifyValidationHeader(t)).filter(Boolean);
  if (cats.length >= 2 && (cats.includes("qty") || cats.includes("name") || cats.includes("description"))) {
    const firstQty = cats.indexOf("qty");
    const firstName = Math.min(
      cats.includes("name") ? cats.indexOf("name") : 999,
      cats.includes("description") ? cats.indexOf("description") : 999
    );
    if (firstQty !== -1 && firstQty < firstName) {
      return "QTY_FIRST";
    }
    return "NAME_FIRST";
  }

  return null;
}

/**
 * Extrae ítems de líneas de texto libre (provenientes de OCR de fotografías de Conduces/Facturas, párrafos de Word o PDF)
 */
export function parseFreeTextLinesToItems(lines: string[]): RawExtractedDocItem[] {
  if (!lines || lines.length === 0) return [];

  // 1. Buscar si existe una línea explícita de encabezado de tabla ("Descripción Cantidad" o "Cantidad | Descripción | Precio")
  let tableHeaderIdx = -1;
  let tableLayout: "NAME_FIRST" | "QTY_FIRST" | "AUTO" = "AUTO";

  for (let i = 0; i < lines.length; i++) {
    const detected = detectTableHeaderLine(lines[i]);
    if (detected) {
      tableHeaderIdx = i;
      tableLayout = detected;
      break;
    }
  }

  const startIdx = tableHeaderIdx !== -1 ? tableHeaderIdx + 1 : 0;
  let expectedTotalUnits: number | undefined;
  let explicitTwoDecimalCount = 0;

  interface CandidateRow {
    numeroItem: string;
    nombreProducto: string;
    unidadMedida: string;
    cantidad: number;
    rawCantidadStr: string;
    costoUnitario?: number;
    fechaVencimiento?: string;
    lote?: string;
    hadLeadingNumber: boolean;
    leadingNumberVal?: number;
  }

  const candidates: CandidateRow[] = [];
  let borderArtifactSeenInTable = false;

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i].replace(/\s+/g, " ").trim();
    if (rawLine.length < 4) continue;

    // Verificar si llegamos al final de la tabla (Totales, Comentarios, Firmas)
    const footerCheck = isTableFooterOrStopLine(rawLine);
    if (footerCheck.isStop) {
      if (footerCheck.totalUnits !== undefined && footerCheck.totalUnits > 0) {
        expectedTotalUnits = footerCheck.totalUnits;
      }
      // Si ya encontramos productos en la tabla y llegamos al pie de tabla, detener lectura para no meter sellos/firmas
      if (candidates.length > 0 || tableHeaderIdx !== -1) {
        break;
      }
      continue;
    }

    // Ignorar otro encabezado de tabla repetido
    if (detectTableHeaderLine(rawLine) !== null) continue;

    // Ignorar metadatos de encabezado (RNC, Teléfono, Dirección, Nombre Cliente, Conduce, etc.)
    if (isDocumentMetadataOrNoiseLine(rawLine)) continue;

    // Limpiar marcas de lapicero o guiones al final de la línea (ej: "150.00 =—" -> "150.00")
    let working = rawLine.replace(/[\s=—\-~_.,;*•|\/\\]+$/, "").trim();
    if (working.length < 4) continue;

    // Extraer fecha de vencimiento si aparece en la línea
    let fechaVencimiento = "";
    const dateMatch = working.match(
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/
    );
    if (dateMatch) {
      // Asegurarse de que no sea parte del nombre como "0.45%"
      fechaVencimiento = normalizeValidationDate(dateMatch[1]);
      if (fechaVencimiento) {
        working = working.replace(dateMatch[0], " ").trim();
      }
    }

    // Extraer precio unitario / costo con marcador de moneda (RD$, RDS, RD$S, US$, $)
    // Soporta variantes OCR como "RDS 890.00 R", "RDS — 3,680.00 R", "RD$S — 1,399.00 RE"
    let costoUnitario: number | undefined;
    const currencyTailRegex =
      /\b(?:RD[\$S58]+|US[\$S]+|\$)\s*[—\-~:=]*\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2})?)(?:\s+(?:R[DECS\$58]{0,2}|\d[\d.,]*))*\s*$/i;
    const priceTailMatch = working.match(currencyTailRegex);
    if (priceTailMatch) {
      costoUnitario = parseNumericValue(priceTailMatch[1]);
      working = working.slice(0, priceTailMatch.index).trim();
    } else {
      const inlinePriceMatch = working.match(
        /\b(?:RD[\$S58]+|US[\$S]+|\$)\s*[—\-~:=]*\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2})?)/i
      );
      if (inlinePriceMatch) {
        costoUnitario = parseNumericValue(inlinePriceMatch[1]);
        working = working.replace(inlinePriceMatch[0], " ").trim();
      }
    }

    // Limpiar fragmentos de columna truncada al final si quedaron (ej. "RD$", "RDS", "RE")
    working = working
      .replace(/\s+(?:RD[\$S58]*|R[DECS])\s*$/i, "")
      .replace(/[\s=—\-~_.,;*•|\/\\]+$/, "")
      .trim();

    // Detectar si hay un número al inicio de la línea (puede ser Cantidad en formato Baruc Pharma o N° de ítem)
    let leadingNumVal: number | undefined;
    let hadBorderAfterLeadingNum = false;
    const leadingNumMatch = working.match(/^(\d{1,5}(?:[.,]\d{1,2})?)\s*([|\[\]()!¡]?\s+)/);
    if (leadingNumMatch) {
      leadingNumVal = parseNumericValue(leadingNumMatch[1]);
      if (/[|\[\]()!¡]/.test(leadingNumMatch[2])) {
        hadBorderAfterLeadingNum = true;
        borderArtifactSeenInTable = true;
      }
      working = working.slice(leadingNumMatch[0].length).trim();
    }

    // Detectar si hay un número de cantidad al final de la línea (formato A&S Importadora: "MOVIBLE DESECHABLE / SABANITA* 150.00")
    // Ojo: No confundir el número final del nombre del producto (ej: "TUBO TORAXICO 12", "TUBO TORAXICO 24", "120ML", "1000ML", "C/100", "30 CAPS") con la cantidad cuando el layout es QTY_FIRST!
    let trailingQtyVal: number | undefined;
    let rawTrailingQtyStr = "";

    if (tableLayout !== "QTY_FIRST" || leadingNumVal === undefined) {
      const trailingQtyMatch = working.match(
        /\s+(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:unds?|unidades|cajas?|fcos?|amp|comp|tab)?$/i
      );
      if (trailingQtyMatch) {
        const candidateStr = trailingQtyMatch[1];
        const beforeTrailing = working.slice(0, trailingQtyMatch.index).trim();
        // Si ya tenemos leadingNumVal (ej. "25 [TUBO TORAXICO 24") y el número final es parte del calibre/medida ("TUBO TORAXICO 24"), NO tomar "24" como cantidad
        const isSizeOrCaliberInName =
          leadingNumVal !== undefined &&
          /\b(tubo|toraxico|toracico|cateter|sonda|jeringa|aguja|french|fr|calibre|no|num|vitamina|complejo)\s*$/i.test(
            beforeTrailing
          );

        if (!isSizeOrCaliberInName && /[a-zA-Z]{3,}/.test(beforeTrailing)) {
          trailingQtyVal = parseNumericValue(candidateStr);
          rawTrailingQtyStr = candidateStr;
          working = beforeTrailing;

          if (/^\d+\.\d{2}$/.test(candidateStr)) {
            explicitTwoDecimalCount++;
          }

          // Verificar si había un segundo número al final (Cantidad + Costo sin símbolo RD$)
          const secondTrailing = working.match(/\s+(\d{1,5}(?:[.,]\d{1,2})?)$/);
          if (secondTrailing && costoUnitario === undefined && leadingNumVal === undefined) {
            const firstNum = parseNumericValue(secondTrailing[1]);
            const beforeSecond = working.slice(0, secondTrailing.index).trim();
            if (
              /[a-zA-Z]{3,}/.test(beforeSecond) &&
              !/\b(tubo|toraxico|toracico|cateter|sonda|mg|ml|gr)\s*$/i.test(beforeSecond)
            ) {
              costoUnitario = trailingQtyVal;
              trailingQtyVal = firstNum;
              rawTrailingQtyStr = secondTrailing[1];
              working = beforeSecond;
            }
          }
        }
      }
    }

    const cleanedName = cleanOcrProductName(
      working,
      hadBorderAfterLeadingNum || borderArtifactSeenInTable
    );

    // Validar que el nombre del producto sea legítimo (al menos 3 letras y no sea ruido de firmas/sellos)
    const letterCount = (cleanedName.match(/[a-zA-Z]/g) || []).length;
    if (letterCount < 3) continue;
    if (isDocumentMetadataOrNoiseLine(cleanedName)) continue;

    // Determinar cantidad y número de ítem según la estructura de la fila
    let cantidad = 0;
    let numeroItem = String(candidates.length + 1);
    let rawCantidadStr = "";

    if (tableLayout === "QTY_FIRST" && leadingNumVal !== undefined) {
      cantidad = leadingNumVal;
      rawCantidadStr = String(leadingNumVal);
    } else if (tableLayout === "NAME_FIRST" && trailingQtyVal !== undefined) {
      cantidad = trailingQtyVal;
      rawCantidadStr = rawTrailingQtyStr;
      if (leadingNumVal !== undefined) {
        numeroItem = String(leadingNumVal);
      }
    } else if (leadingNumVal !== undefined && trailingQtyVal === undefined) {
      // Solo hay número al inicio (ej. "10 NOR-CREZINC JARABE 120ML RD$ 890.00"): es la Cantidad
      cantidad = leadingNumVal;
      rawCantidadStr = String(leadingNumVal);
    } else if (trailingQtyVal !== undefined && leadingNumVal === undefined) {
      // Solo hay número al final (ej. "DICLOFENAC 75 MG AMP C/100 100.00"): es la Cantidad
      cantidad = trailingQtyVal;
      rawCantidadStr = rawTrailingQtyStr;
    } else if (leadingNumVal !== undefined && trailingQtyVal !== undefined) {
      // Hay número al inicio y al final: el primero es ítem y el último es cantidad
      numeroItem = String(leadingNumVal);
      cantidad = trailingQtyVal;
      rawCantidadStr = rawTrailingQtyStr;
    }

    if (cantidad <= 0) continue;

    const detectedPres = extractNormalizedPresentations(cleanedName);
    const unidadMedida =
      detectedPres.length > 0
        ? detectedPres[0].charAt(0).toUpperCase() + detectedPres[0].slice(1)
        : "Unidad";

    candidates.push({
      numeroItem,
      nombreProducto: cleanedName,
      unidadMedida,
      cantidad,
      rawCantidadStr,
      costoUnitario: costoUnitario && costoUnitario > 0 ? costoUnitario : undefined,
      fechaVencimiento: fechaVencimiento || undefined,
      hadLeadingNumber: leadingNumVal !== undefined,
      leadingNumberVal: leadingNumVal
    });
  }

  // 2. Reconciliación inteligente de decimales ".00" omitidos por OCR (ej: "25.00" leído como "2500" cuando otras filas son "150.00", "100.00" y Total = 275.00)
  if (candidates.length > 0) {
    if (expectedTotalUnits !== undefined && expectedTotalUnits > 0) {
      const currentSum = candidates.reduce((acc, c) => acc + c.cantidad, 0);
      if (Math.abs(currentSum - expectedTotalUnits) > 0.01) {
        for (const c of candidates) {
          if (c.cantidad >= 100 && c.cantidad % 100 === 0 && !c.rawCantidadStr.includes(".")) {
            const adjusted = c.cantidad / 100;
            const newSum = currentSum - c.cantidad + adjusted;
            if (Math.abs(newSum - expectedTotalUnits) < 0.01) {
              c.cantidad = adjusted;
              break;
            }
          }
        }
      }
    } else if (explicitTwoDecimalCount >= 1) {
      // Si la columna usa formato ".00" (ej. 150.00, 100.00) y una fila salió como entero >= 1000 terminado en "00" (ej. 2500)
      for (const c of candidates) {
        if (c.cantidad >= 1000 && c.cantidad % 100 === 0 && !c.rawCantidadStr.includes(".")) {
          c.cantidad = c.cantidad / 100;
        }
      }
    }
  }

  return candidates.map((c, idx) => ({
    numeroItem: c.numeroItem || String(idx + 1),
    nombreProducto: c.nombreProducto,
    unidadMedida: c.unidadMedida,
    cantidad: c.cantidad,
    costoUnitario: c.costoUnitario,
    fechaVencimiento: c.fechaVencimiento,
    lote: c.lote
  }));
}

/**
 * Descomprime y extrae tablas (<w:tbl>) y párrafos (<w:p>) desde un archivo Microsoft Word (.docx)
 * 100% en el navegador usando DecompressionStream("deflate-raw").
 */
export async function extractWordDocxContent(
  arrayBuffer: ArrayBuffer
): Promise<{ matrices: string[][][]; lines: string[] }> {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Verificar firma PKZIP (0x04034b50)
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x04034b50) {
    let offset = 0;
    let documentXmlText = "";

    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);

      const nameStart = offset + 30;
      const nameBytes = bytes.subarray(nameStart, nameStart + fileNameLength);
      const entryName = new TextDecoder("utf-8").decode(nameBytes);

      const dataStart = nameStart + fileNameLength + extraFieldLength;
      const dataEnd = dataStart + compressedSize;

      if (entryName === "word/document.xml" && dataEnd <= bytes.length) {
        const entrySlice = bytes.subarray(dataStart, dataEnd);
        if (compressionMethod === 0) {
          documentXmlText = new TextDecoder("utf-8").decode(entrySlice);
        } else if (compressionMethod === 8 && typeof DecompressionStream !== "undefined") {
          try {
            const ds = new DecompressionStream("deflate-raw");
            const writer = ds.writable.getWriter();
            writer.write(entrySlice).catch(() => {});
            writer.close().catch(() => {});
            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                total += value.length;
              }
            }
            const out = new Uint8Array(total);
            let pos = 0;
            for (const c of chunks) {
              out.set(c, pos);
              pos += c.length;
            }
            documentXmlText = new TextDecoder("utf-8").decode(out);
          } catch {}
        }
        break;
      }

      if (compressedSize === 0) break;
      offset = dataEnd;
    }

    if (documentXmlText) {
      const extractTextFromXmlFragment = (xmlFrag: string): string => {
        const texts: string[] = [];
        const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
        let m: RegExpExecArray | null;
        while ((m = tRegex.exec(xmlFrag)) !== null) {
          texts.push(
            m[1]
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
          );
        }
        return texts.join("").replace(/\s+/g, " ").trim();
      };

      const matrices: string[][][] = [];
      const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
      let tblMatch: RegExpExecArray | null;
      while ((tblMatch = tblRegex.exec(documentXmlText)) !== null) {
        const tblXml = tblMatch[0];
        const rows: string[][] = [];
        const trRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRegex.exec(tblXml)) !== null) {
          const cells: string[] = [];
          const tcRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
          let tcMatch: RegExpExecArray | null;
          while ((tcMatch = tcRegex.exec(trMatch[0])) !== null) {
            cells.push(extractTextFromXmlFragment(tcMatch[0]));
          }
          if (cells.some((c) => c !== "")) {
            rows.push(cells);
          }
        }
        if (rows.length > 0) {
          matrices.push(rows);
        }
      }

      const lines: string[] = [];
      const pRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = pRegex.exec(documentXmlText)) !== null) {
        const line = extractTextFromXmlFragment(pMatch[0]);
        if (line) lines.push(line);
      }

      return { matrices, lines };
    }
  }

  // Fallback para archivos .doc basados en HTML / XML / texto plano
  const rawText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (rawText.includes("<table") || rawText.includes("<tr")) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawText, "text/html");
    const matrices: string[][][] = [];
    doc.querySelectorAll("table").forEach((tbl) => {
      const rows: string[][] = [];
      tbl.querySelectorAll("tr").forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll("th, td").forEach((td) => {
          cells.push((td.textContent || "").replace(/\s+/g, " ").trim());
        });
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (rows.length > 0) matrices.push(rows);
    });
    const lines = (doc.body?.innerText || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return { matrices, lines };
  }

  const cleanLines = rawText
    .replace(/[^\x20-\x7E\xA0-\xFF\r\n\t]/g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 4);

  return { matrices: [], lines: cleanLines };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}

/**
 * Extrae imágenes JPEG incrustadas dentro de un PDF escaneado (ej. CamScanner PDF con /Filter /DCTDecode)
 * para poder aplicarles OCR en el navegador cuando el PDF no contiene capa de texto.
 */
function extractEmbeddedJpegsFromPdfBuffer(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  const jpegs: string[] = [];
  let i = 0;

  while (i < bytes.length - 4 && jpegs.length < 4) {
    // Buscar marcador JPEG SOI: 0xFF 0xD8 0xFF
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      let end = i + 3;
      let foundEnd = -1;
      while (end < bytes.length - 1) {
        if (bytes[end] === 0xff && bytes[end + 1] === 0xd9) {
          foundEnd = end + 2;
          // Seguir buscando un poco más por si era un thumbnail EXIF interno
          if (foundEnd - i > 12000) {
            break;
          }
        }
        end++;
      }
      if (foundEnd !== -1 && foundEnd - i > 8000) {
        const jpegSlice = bytes.subarray(i, foundEnd);
        const b64 = arrayBufferToBase64(
          jpegSlice.buffer.slice(jpegSlice.byteOffset, jpegSlice.byteOffset + jpegSlice.byteLength)
        );
        jpegs.push(`data:image/jpeg;base64,${b64}`);
        i = foundEnd;
        continue;
      }
    }
    i++;
  }

  return jpegs;
}

/**
 * Normaliza, redimensiona y optimiza el contraste de una fotografía tomada con cámara móvil o archivo de imagen
 * usando HTML5 Canvas para que tanto el servidor IA como Tesseract.js en móvil procesen rápido y sin errores de memoria.
 */
async function prepareImageForOcrInBrowser(
  file: File
): Promise<{ previewDataUrl: string; ocrDataUrl: string; base64Data: string; mimeType: string }> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    const buffer = await file.arrayBuffer();
    const base64Data = arrayBufferToBase64(buffer);
    const mimeType = file.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    return { previewDataUrl: dataUrl, ocrDataUrl: dataUrl, base64Data, mimeType };
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        URL.revokeObjectURL(objectUrl);
        const origW = img.naturalWidth || img.width || 1200;
        const origH = img.naturalHeight || img.height || 1600;

        // Escalar a máximo 2000px en el lado mayor (o mínimo 1200px si era muy pequeña) para lectura óptica nítida
        const maxDim = Math.max(origW, origH);
        let scale = 1;
        if (maxDim > 2000) {
          scale = 2000 / maxDim;
        } else if (maxDim < 1000 && maxDim > 0) {
          scale = 1200 / maxDim;
        }

        const targetW = Math.max(1, Math.round(origW * scale));
        const targetH = Math.max(1, Math.round(origH * scale));

        // 1. Canvas de vista previa e IA (color nítido, JPEG comprimido ~500KB)
        const previewCanvas = document.createElement("canvas");
        previewCanvas.width = targetW;
        previewCanvas.height = targetH;
        const pCtx = previewCanvas.getContext("2d");
        if (pCtx) {
          pCtx.fillStyle = "#FFFFFF";
          pCtx.fillRect(0, 0, targetW, targetH);
          pCtx.drawImage(img, 0, 0, targetW, targetH);
        }
        const previewDataUrl = previewCanvas.toDataURL("image/jpeg", 0.88);
        const base64Data = previewDataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

        // 2. Canvas optimizado para OCR local Tesseract (alto contraste en escala de grises limpia)
        const ocrCanvas = document.createElement("canvas");
        ocrCanvas.width = targetW;
        ocrCanvas.height = targetH;
        const oCtx = ocrCanvas.getContext("2d");
        if (oCtx) {
          oCtx.fillStyle = "#FFFFFF";
          oCtx.fillRect(0, 0, targetW, targetH);
          oCtx.drawImage(img, 0, 0, targetW, targetH);

          const imgData = oCtx.getImageData(0, 0, targetW, targetH);
          const d = imgData.data;
          // Estiramiento suave de contraste en luminancia para documentos fotografiados con sombras de celular
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            // Empujar fondos grises claros de papel hacia blanco puro y oscurecer tinta de texto
            let enhanced: number;
            if (lum > 195) {
              enhanced = 255;
            } else if (lum < 85) {
              enhanced = Math.max(0, Math.round(lum * 0.6));
            } else {
              enhanced = Math.min(255, Math.max(0, Math.round(((lum - 85) / (195 - 85)) * 235 + 10)));
            }
            d[i] = enhanced;
            d[i + 1] = enhanced;
            d[i + 2] = enhanced;
          }
          oCtx.putImageData(imgData, 0, 0);
        }
        const ocrDataUrl = ocrCanvas.toDataURL("image/jpeg", 0.92);

        resolve({
          previewDataUrl,
          ocrDataUrl,
          base64Data,
          mimeType: "image/jpeg"
        });
      } catch {
        // Fallback seguro si el canvas falla
        file.arrayBuffer().then((buffer) => {
          const b64 = arrayBufferToBase64(buffer);
          const mime = file.type || "image/jpeg";
          const url = `data:${mime};base64,${b64}`;
          resolve({ previewDataUrl: url, ocrDataUrl: url, base64Data: b64, mimeType: mime });
        });
      }
    };

    img.onerror = async () => {
      URL.revokeObjectURL(objectUrl);
      const buffer = await file.arrayBuffer();
      const base64Data = arrayBufferToBase64(buffer);
      const mimeType = file.type || "image/jpeg";
      const dataUrl = `data:${mimeType};base64,${base64Data}`;
      resolve({ previewDataUrl: dataUrl, ocrDataUrl: dataUrl, base64Data, mimeType });
    };

    img.src = objectUrl;
  });
}

/**
 * Intenta extraer ítems mediante el endpoint de IA y OCR del servidor (/api/validacion/ocr-ai)
 */
async function tryServerGeminiOcrAi(payload: {
  base64Data?: string;
  mimeType?: string;
  extractedText?: string;
  fileName: string;
}): Promise<RawExtractedDocItem[] | null> {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);
    const resp = await fetch("/api/validacion/ocr-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.ok && Array.isArray(data.items) && data.items.length > 0) {
      return data.items.map((it: any, idx: number) => ({
        numeroItem: String(it.numeroItem || idx + 1),
        nombreProducto: cleanOcrProductName(String(it.nombreProducto || "")),
        unidadMedida: String(it.unidadMedida || "Unidad").trim(),
        cantidad: Number(it.cantidad || 0),
        costoUnitario:
          it.costoUnitario && Number(it.costoUnitario) > 0 ? Number(it.costoUnitario) : undefined,
        fechaVencimiento: normalizeValidationDate(it.fechaVencimiento) || undefined,
        lote: it.lote ? String(it.lote).trim() : undefined
      }));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ejecuta OCR local en el navegador con Tesseract.js sobre una imagen (cuando el servidor IA no está disponible, ej. GitHub Pages)
 */
async function runBrowserTesseractOcr(
  imageDataUrl: string,
  onProgress?: (statusText: string) => void
): Promise<string> {
  try {
    onProgress?.("Iniciando motor de lectura óptica OCR en español...");
    const Tesseract = await import("tesseract.js");
    const recognizeFn = Tesseract.recognize || (Tesseract as any).default?.recognize;
    if (!recognizeFn) return "";

    const result = await recognizeFn(imageDataUrl, "spa", {
      logger: (m: any) => {
        if (m?.status === "recognizing text" && typeof m.progress === "number") {
          onProgress?.(`Escaneando documento con OCR (${Math.round(m.progress * 100)}%)...`);
        } else if (m?.status === "loading language traineddata") {
          onProgress?.("Cargando diccionario médico y español para OCR...");
        }
      }
    });
    return result?.data?.text || "";
  } catch (err) {
    console.warn("Error en OCR local Tesseract:", err);
    return "";
  }
}

/**
 * Función principal para procesar cualquier archivo (PDF, Word, Excel o Imagen) y extraer sus ítems para validación
 */
export async function extractItemsFromValidationDocument(
  file: File,
  onProgress?: (statusText: string) => void
): Promise<DocumentExtractionOutput> {
  const fileName = file.name || "documento";
  const lower = fileName.toLowerCase();
  const mime = file.type || "";

  // 1. EXCEL / CSV (.xlsx, .xls, .csv)
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    onProgress?.("Leyendo libro de Excel y analizando columnas...");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    let allItems: RawExtractedDocItem[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      const parsed = parseMatrixToValidationItems(matrix);
      if (parsed.length > 0) {
        allItems = [...allItems, ...parsed];
      }
    }

    return {
      tipoDocumento: "Excel",
      metodoExtraccion: "PARSER_ESTRUCTURADO",
      rawItems: allItems
    };
  }

  // 2. WORD (.docx, .doc, .rtf)
  if (
    lower.endsWith(".docx") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".rtf") ||
    mime.includes("word") ||
    mime.includes("officedocument.wordprocessingml")
  ) {
    onProgress?.("Extrayendo tablas y contenido del documento Word...");
    const buffer = await file.arrayBuffer();
    const { matrices, lines } = await extractWordDocxContent(buffer);

    let items: RawExtractedDocItem[] = [];
    for (const mat of matrices) {
      const parsed = parseMatrixToValidationItems(mat);
      if (parsed.length > 0) {
        items = [...items, ...parsed];
      }
    }

    const joinedText = lines.join("\n");
    if (items.length === 0 && joinedText.trim().length > 0) {
      onProgress?.("Analizando estructura del documento Word...");
      const aiItems = await tryServerGeminiOcrAi({
        extractedText: joinedText,
        fileName
      });
      if (aiItems && aiItems.length > 0) {
        return {
          tipoDocumento: "Word",
          metodoExtraccion: "IA_OCR",
          rawItems: aiItems,
          textoCrudo: joinedText
        };
      }
      items = parseFreeTextLinesToItems(lines);
    }

    return {
      tipoDocumento: "Word",
      metodoExtraccion: "PARSER_ESTRUCTURADO",
      rawItems: items,
      textoCrudo: joinedText
    };
  }

  // 3. PDF (.pdf)
  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    onProgress?.("Escaneando páginas y tablas del documento PDF...");
    const buffer = await file.arrayBuffer();
    const pdfResult = await extractTableMatrixFromPdf(buffer, classifyValidationHeader);
    let items = parseMatrixToValidationItems(pdfResult.matrix);

    let flatText = pdfResult.matrix.map((r) => r.join(" | ")).join("\n");

    // Si el PDF es escaneado (ej. CamScanner PDF) o no tenía encabezados tabulares
    if (items.length === 0) {
      onProgress?.("Analizando documento PDF mediante OCR e Inteligencia Artificial...");
      const base64Data = arrayBufferToBase64(buffer);
      const aiItems = await tryServerGeminiOcrAi({
        base64Data,
        mimeType: "application/pdf",
        extractedText: flatText || undefined,
        fileName
      });
      if (aiItems && aiItems.length > 0) {
        return {
          tipoDocumento: "PDF",
          metodoExtraccion: "IA_OCR",
          rawItems: aiItems,
          textoCrudo: flatText
        };
      }

      // Si el PDF es un documento escaneado (imágenes JPEG incrustadas dentro del PDF, como CamScanner), extraer las imágenes y pasarles OCR
      const embeddedJpegs = extractEmbeddedJpegsFromPdfBuffer(buffer);
      if (embeddedJpegs.length > 0) {
        const ocrTexts: string[] = [];
        for (let p = 0; p < embeddedJpegs.length; p++) {
          onProgress?.(`Aplicando OCR óptico a página escaneada ${p + 1} de ${embeddedJpegs.length}...`);
          const pageText = await runBrowserTesseractOcr(embeddedJpegs[p], onProgress);
          if (pageText) ocrTexts.push(pageText);
        }
        const combinedOcr = ocrTexts.join("\n");
        if (combinedOcr.trim()) {
          flatText = combinedOcr;
          const ocrLines = combinedOcr
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          items = parseFreeTextLinesToItems(ocrLines);
        }
        return {
          tipoDocumento: "PDF",
          metodoExtraccion: "OCR_LOCAL",
          rawItems: items,
          textoCrudo: flatText,
          previewImageUrl: embeddedJpegs[0]
        };
      }
    }

    return {
      tipoDocumento: "PDF",
      metodoExtraccion: "PARSER_ESTRUCTURADO",
      rawItems: items,
      textoCrudo: flatText
    };
  }

  // 4. IMÁGENES / FOTOGRAFÍAS DE CÁMARA (.jpg, .jpeg, .png, .webp, .heic)
  onProgress?.("Optimizando nitidez y contraste de la fotografía...");
  const prepared = await prepareImageForOcrInBrowser(file);

  // 4a. Intentar primero con Gemini Vision OCR en el servidor (si está disponible)
  onProgress?.("Analizando imagen del documento para detectar productos y cantidades...");
  const aiItems = await tryServerGeminiOcrAi({
    base64Data: prepared.base64Data,
    mimeType: prepared.mimeType,
    fileName
  });

  if (aiItems && aiItems.length > 0) {
    return {
      tipoDocumento: "Imagen",
      metodoExtraccion: "IA_OCR",
      rawItems: aiItems,
      previewImageUrl: prepared.previewDataUrl
    };
  }

  // 4b. Ejecutar OCR óptico en el navegador con Tesseract.js sobre la imagen optimizada
  let ocrText = await runBrowserTesseractOcr(prepared.ocrDataUrl, onProgress);
  let ocrLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let localOcrItems = parseFreeTextLinesToItems(ocrLines);

  // Si la versión de alto contraste obtuvo 0 filas, reintentar con la imagen original redimensionada
  if (localOcrItems.length === 0 && prepared.previewDataUrl !== prepared.ocrDataUrl) {
    const rawOcrText = await runBrowserTesseractOcr(prepared.previewDataUrl, onProgress);
    if (rawOcrText.trim().length > ocrText.trim().length) {
      ocrText = rawOcrText;
    }
    const fallbackLines = rawOcrText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const fallbackItems = parseFreeTextLinesToItems(fallbackLines);
    if (fallbackItems.length > 0) {
      localOcrItems = fallbackItems;
    }
  }

  return {
    tipoDocumento: "Imagen",
    metodoExtraccion: "OCR_LOCAL",
    rawItems: localOcrItems,
    textoCrudo: ocrText,
    previewImageUrl: prepared.previewDataUrl
  };
}

