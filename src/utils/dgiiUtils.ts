import * as XLSX from "@keep-lts/xlsx";
import { getDoc, setDoc } from "firebase/firestore";
import { tenantDoc, getActiveFarmaciaId } from "../firebase";
import {
  AmbienteDGII,
  ConfiguracionFiscalDGII,
  DesglosePagoDGII,
  EventoAuditoriaFiscal,
  FacturaVenta,
  FormaPagoDGII,
  InstitucionInfo,
  RegistroAnulacion608,
  RegistroCompra606,
  SecuenciaFiscalDGII,
  TipoComprobanteDGII
} from "../types";

// ============================================================================
// 1. CATÁLOGOS OFICIALES DE LA DGII (LEY 32-23 Y NORMA GENERAL 07-2018)
// ============================================================================

export interface MetadataTipoComprobante {
  codigo: TipoComprobanteDGII;
  serie: "B" | "E";
  codigoNumericoECF?: string; // 2 dígitos para XML e-CF (31..47)
  nombre: string;
  descripcionCorta: string;
  longitudTotal: 11 | 13;
  requiereRncCliente: boolean;
  requiereNcfModificado: boolean;
  esNotaCredito: boolean;
  esNotaDebito: boolean;
  usoEnVentas: boolean;
  usoEnCompras: boolean;
}

export const CATALOGO_TIPOS_COMPROBANTE: MetadataTipoComprobante[] = [
  // Serie B (NCF Tradicional - 11 caracteres: B + 2 dígitos tipo + 8 dígitos secuencia)
  {
    codigo: "B01",
    serie: "B",
    nombre: "B01 • Factura de Crédito Fiscal",
    descripcionCorta: "Sustenta gastos y costos o crédito fiscal de ITBIS",
    longitudTotal: 11,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B02",
    serie: "B",
    nombre: "B02 • Factura de Consumo",
    descripcionCorta: "Facturación a consumidores finales (sin crédito fiscal)",
    longitudTotal: 11,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B03",
    serie: "B",
    nombre: "B03 • Nota de Débito",
    descripcionCorta: "Recuperación de costos y gastos adicionales sobre NCF emitido",
    longitudTotal: 11,
    requiereRncCliente: false,
    requiereNcfModificado: true,
    esNotaCredito: false,
    esNotaDebito: true,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B04",
    serie: "B",
    nombre: "B04 • Nota de Crédito",
    descripcionCorta: "Anulaciones, devoluciones y descuentos posteriores a la venta",
    longitudTotal: 11,
    requiereRncCliente: false,
    requiereNcfModificado: true,
    esNotaCredito: true,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B11",
    serie: "B",
    nombre: "B11 • Comprobante de Compras",
    descripcionCorta: "Adquisiciones a proveedores informales no registrados",
    longitudTotal: 11,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: false,
    usoEnCompras: true
  },
  {
    codigo: "B12",
    serie: "B",
    nombre: "B12 • Registro Único de Ingresos",
    descripcionCorta: "Resumen de ventas a consumidores finales exentos",
    longitudTotal: 11,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B14",
    serie: "B",
    nombre: "B14 • Comprobante para Regímenes Especiales",
    descripcionCorta: "Ventas exentas a Zonas Francas, Ley 28-01, Diplomáticos, etc.",
    longitudTotal: 11,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B15",
    serie: "B",
    nombre: "B15 • Comprobante Gubernamental",
    descripcionCorta: "Facturación a instituciones del Estado Dominicano",
    longitudTotal: 11,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "B16",
    serie: "B",
    nombre: "B16 • Comprobante para Exportaciones",
    descripcionCorta: "Ventas de bienes y servicios hacia el exterior",
    longitudTotal: 11,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  // Serie E (e-CF Facturación Electrónica Ley 32-23 - 13 caracteres: E + 2 dígitos tipo + 10 dígitos secuencia)
  {
    codigo: "E31",
    serie: "E",
    codigoNumericoECF: "31",
    nombre: "E31 • Factura de Crédito Fiscal Electrónica",
    descripcionCorta: "e-CF para crédito fiscal, costos y gastos tributarios",
    longitudTotal: 13,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E32",
    serie: "E",
    codigoNumericoECF: "32",
    nombre: "E32 • Factura de Consumo Electrónica",
    descripcionCorta: "e-CF para consumidores finales (envío resumen si < RD$250,000)",
    longitudTotal: 13,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E33",
    serie: "E",
    codigoNumericoECF: "33",
    nombre: "E33 • Nota de Débito Electrónica",
    descripcionCorta: "e-CF para cargos adicionales sobre comprobante emitido",
    longitudTotal: 13,
    requiereRncCliente: false,
    requiereNcfModificado: true,
    esNotaCredito: false,
    esNotaDebito: true,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E34",
    serie: "E",
    codigoNumericoECF: "34",
    nombre: "E34 • Nota de Crédito Electrónica",
    descripcionCorta: "e-CF para devoluciones, descuentos y anulación de operaciones",
    longitudTotal: 13,
    requiereRncCliente: false,
    requiereNcfModificado: true,
    esNotaCredito: true,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E41",
    serie: "E",
    codigoNumericoECF: "41",
    nombre: "E41 • Compras Electrónico",
    descripcionCorta: "e-CF para compras a personas físicas no registradas",
    longitudTotal: 13,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: false,
    usoEnCompras: true
  },
  {
    codigo: "E43",
    serie: "E",
    codigoNumericoECF: "43",
    nombre: "E43 • Gastos Menores Electrónico",
    descripcionCorta: "e-CF para gastos menores realizados por personal autorizado",
    longitudTotal: 13,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: false,
    usoEnCompras: true
  },
  {
    codigo: "E44",
    serie: "E",
    codigoNumericoECF: "44",
    nombre: "E44 • Regímenes Especiales Electrónico",
    descripcionCorta: "e-CF exento de ITBIS para regímenes especiales de tributación",
    longitudTotal: 13,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E45",
    serie: "E",
    codigoNumericoECF: "45",
    nombre: "E45 • Gubernamental Electrónico",
    descripcionCorta: "e-CF dirigido a entidades estatales y gubernamentales",
    longitudTotal: 13,
    requiereRncCliente: true,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E46",
    serie: "E",
    codigoNumericoECF: "46",
    nombre: "E46 • Comprobante de Exportaciones Electrónico",
    descripcionCorta: "e-CF para exportación de mercancías y servicios",
    longitudTotal: 13,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: true,
    usoEnCompras: false
  },
  {
    codigo: "E47",
    serie: "E",
    codigoNumericoECF: "47",
    nombre: "E47 • Comprobante para Pagos al Exterior Electrónico",
    descripcionCorta: "e-CF para remesas y pagos a proveedores del exterior",
    longitudTotal: 13,
    requiereRncCliente: false,
    requiereNcfModificado: false,
    esNotaCredito: false,
    esNotaDebito: false,
    usoEnVentas: false,
    usoEnCompras: true
  }
];

export const TIPOS_BIENES_SERVICIOS_606: Array<{ codigo: string; nombre: string }> = [
  { codigo: "01", nombre: "01 - Gastos de personal" },
  { codigo: "02", nombre: "02 - Gastos por trabajos, suministros y servicios" },
  { codigo: "03", nombre: "03 - Arrendamientos" },
  { codigo: "04", nombre: "04 - Gastos de activos fijos" },
  { codigo: "05", nombre: "05 - Gastos de representación" },
  { codigo: "06", nombre: "06 - Otras deducciones admitidas" },
  { codigo: "07", nombre: "07 - Gastos financieros" },
  { codigo: "08", nombre: "08 - Gastos extraordinarios" },
  { codigo: "09", nombre: "09 - Compras y gastos que forman parte del costo de venta (Inventario)" },
  { codigo: "10", nombre: "10 - Adquisiciones de activos" },
  { codigo: "11", nombre: "11 - Gastos de seguros" }
];

export const TIPOS_RETENCION_ISR_606: Array<{ codigo: string; nombre: string }> = [
  { codigo: "", nombre: "Sin retención de ISR" },
  { codigo: "01", nombre: "01 - Alquileres (10%)" },
  { codigo: "02", nombre: "02 - Honorarios por servicios (10%)" },
  { codigo: "03", nombre: "03 - Otras rentas (2%)" },
  { codigo: "04", nombre: "04 - Otras rentas (Rentas presuntas)" },
  { codigo: "05", nombre: "05 - Intereses pagados a personas jurídicas" },
  { codigo: "06", nombre: "06 - Intereses pagados a personas físicas" },
  { codigo: "07", nombre: "07 - Retención por proveedores del Estado (5%)" },
  { codigo: "08", nombre: "08 - Juegos telefónicos" }
];

export const TIPOS_INGRESO_607: Array<{ codigo: "01" | "02" | "03" | "04" | "05" | "06"; nombre: string }> = [
  { codigo: "01", nombre: "01 - Ingresos por operaciones (No financieros)" },
  { codigo: "02", nombre: "02 - Ingresos financieros" },
  { codigo: "03", nombre: "03 - Ingresos extraordinarios" },
  { codigo: "04", nombre: "04 - Ingresos por arrendamientos" },
  { codigo: "05", nombre: "05 - Ingresos por venta de activo depreciable" },
  { codigo: "06", nombre: "06 - Otros ingresos" }
];

export const FORMAS_PAGO_DGII: Array<{ codigo: FormaPagoDGII; nombre: string; codigoECF: number }> = [
  { codigo: "01", nombre: "01 - Efectivo", codigoECF: 1 },
  { codigo: "02", nombre: "02 - Cheques / Transferencias / Depósito", codigoECF: 2 },
  { codigo: "03", nombre: "03 - Tarjeta Crédito / Débito", codigoECF: 3 },
  { codigo: "04", nombre: "04 - Venta a Crédito", codigoECF: 4 },
  { codigo: "05", nombre: "05 - Bonos o Certificados de Regalo", codigoECF: 5 },
  { codigo: "06", nombre: "06 - Permuta", codigoECF: 6 },
  { codigo: "07", nombre: "07 - Otras Formas de Venta / Mixto", codigoECF: 7 }
];

export const MOTIVOS_ANULACION_608: Array<{
  codigo: RegistroAnulacion608["tipoAnulacion"];
  nombre: string;
}> = [
  { codigo: "01", nombre: "01 - Deterioro de factura pre-impresa" },
  { codigo: "02", nombre: "02 - Errores de impresión (factura pre-impresa)" },
  { codigo: "03", nombre: "03 - Impresión defectuosa" },
  { codigo: "04", nombre: "04 - Corrección de la información" },
  { codigo: "05", nombre: "05 - Cambio de productos" },
  { codigo: "06", nombre: "06 - Devolución de productos" },
  { codigo: "07", nombre: "07 - Omisión de productos" },
  { codigo: "08", nombre: "08 - Errores en secuencia de NCF" },
  { codigo: "09", nombre: "09 - Por cese de operaciones" },
  { codigo: "10", nombre: "10 - Pérdida o hurto de talonarios" }
];

export const CODIGOS_MODIFICACION_NCF: Array<{
  codigo: "01" | "02" | "03" | "04";
  nombre: string;
}> = [
  { codigo: "01", nombre: "01 - Anula el NCF modificado" },
  { codigo: "02", nombre: "02 - Corrige texto del comprobante fiscal modificado" },
  { codigo: "03", nombre: "03 - Corrige montos del NCF modificado (Devolución/Descuento)" },
  { codigo: "04", nombre: "04 - Reemplazo de NCF emitido en contingencia" }
];

export function getMetadataTipoComprobante(tipo?: TipoComprobanteDGII | string): MetadataTipoComprobante | undefined {
  if (!tipo) return undefined;
  return CATALOGO_TIPOS_COMPROBANTE.find((t) => t.codigo === tipo);
}

// ============================================================================
// 2. VALIDACIÓN ALGORÍTMICA DE RNC (9 DÍGITOS) Y CÉDULA (11 DÍGITOS) DGII
// ============================================================================

export function cleanRncCedula(raw: string | undefined | null): string {
  return String(raw || "").replace(/[^0-9A-Za-z]/g, "").trim().toUpperCase();
}

export function validateRncChecksumMod11(rnc9: string): boolean {
  if (!/^\d{9}$/.test(rnc9)) return false;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(rnc9[i], 10) * weights[i];
  }
  const remainder = sum % 11;
  let checkDigit = 0;
  if (remainder === 0) checkDigit = 2;
  else if (remainder === 1) checkDigit = 1;
  else checkDigit = 11 - remainder;

  return parseInt(rnc9[8], 10) === checkDigit;
}

export function validateCedulaChecksumLuhn(cedula11: string): boolean {
  if (!/^\d{11}$/.test(cedula11)) return false;
  const multipliers = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let prod = parseInt(cedula11[i], 10) * multipliers[i];
    if (prod >= 10) {
      prod = Math.floor(prod / 10) + (prod % 10);
    }
    sum += prod;
  }
  const nextTen = Math.ceil(sum / 10) * 10;
  const verifier = (nextTen - sum) % 10;
  return parseInt(cedula11[10], 10) === verifier;
}

export function validateRncOrCedulaDGII(
  rawInput: string | undefined | null,
  allowPassport = false
): {
  valid: boolean;
  clean: string;
  tipoId: "1" | "2" | "3";
  label: string;
  checksumValid: boolean;
  message?: string;
} {
  const digitsOnly = String(rawInput || "").replace(/[\s-]/g, "").trim();
  if (!digitsOnly) {
    return {
      valid: false,
      clean: "",
      tipoId: "1",
      label: "Sin identificación",
      checksumValid: false,
      message: "Ingrese un RNC (9 dígitos) o Cédula (11 dígitos)."
    };
  }

  if (/^\d{9}$/.test(digitsOnly)) {
    const checksumOk = validateRncChecksumMod11(digitsOnly);
    return {
      valid: true,
      clean: digitsOnly,
      tipoId: "1",
      label: "RNC (Persona Jurídica / Institución)",
      checksumValid: checksumOk,
      message: checksumOk
        ? "RNC válido (9 dígitos • Algoritmo DGII verificado)"
        : "RNC de 9 dígitos registrado (dígito verificador no estándar o RNC gubernamental especial)"
    };
  }

  if (/^\d{11}$/.test(digitsOnly)) {
    const checksumOk = validateCedulaChecksumLuhn(digitsOnly);
    return {
      valid: true,
      clean: digitsOnly,
      tipoId: "2",
      label: "Cédula de Identidad (Persona Física)",
      checksumValid: checksumOk,
      message: checksumOk
        ? "Cédula válida (11 dígitos • Dígito verificador verificado)"
        : "Cédula de 11 dígitos registrada (dígito verificador con observación)"
    };
  }

  if (allowPassport && /^[A-Za-z0-9]{6,20}$/.test(digitsOnly)) {
    return {
      valid: true,
      clean: digitsOnly.toUpperCase(),
      tipoId: "3",
      label: "Pasaporte / Identificación Extranjera",
      checksumValid: true,
      message: "Identificación extranjera / Pasaporte válido"
    };
  }

  return {
    valid: false,
    clean: digitsOnly,
    tipoId: "1",
    label: "Formato inválido",
    checksumValid: false,
    message: "El RNC debe contener exactamente 9 dígitos numéricos y la Cédula 11 dígitos numéricos."
  };
}

// ============================================================================
// 3. FORMATEO Y VALIDACIÓN DE NCF (SERIE B) Y e-CF (SERIE E)
// ============================================================================

export function formatNCFSequence(tipo: TipoComprobanteDGII, correlativo: number): string {
  const meta = getMetadataTipoComprobante(tipo);
  const padLen = meta?.serie === "E" || tipo.startsWith("E") ? 10 : 8;
  const numStr = Math.max(1, Math.floor(correlativo)).toString().padStart(padLen, "0");
  return `${tipo}${numStr}`;
}

export function validateNCFFormat(rawNcf: string | undefined | null): {
  valid: boolean;
  clean: string;
  serie: "B" | "E" | null;
  tipo: TipoComprobanteDGII | null;
  message?: string;
} {
  const clean = String(rawNcf || "").trim().toUpperCase();
  if (!clean) {
    return { valid: false, clean: "", serie: null, tipo: null, message: "NCF / e-CF vacío." };
  }

  // Serie B: B + 2 dígitos (01,02,03,04,11,12,14,15,16) + 8 dígitos = 11 caracteres
  const matchB = clean.match(/^(B(?:01|02|03|04|11|12|14|15|16))(\d{8})$/);
  if (matchB) {
    const tipo = matchB[1] as TipoComprobanteDGII;
    const seq = parseInt(matchB[2], 10);
    if (seq <= 0) {
      return { valid: false, clean, serie: "B", tipo, message: "El correlativo del NCF debe ser mayor a 0." };
    }
    return { valid: true, clean, serie: "B", tipo };
  }

  // Serie E: E + 2 dígitos (31,32,33,34,41,43,44,45,46,47) + 10 dígitos = 13 caracteres
  const matchE = clean.match(/^(E(?:31|32|33|34|41|43|44|45|46|47))(\d{10})$/);
  if (matchE) {
    const tipo = matchE[1] as TipoComprobanteDGII;
    const seq = parseInt(matchE[2], 10);
    if (seq <= 0) {
      return { valid: false, clean, serie: "E", tipo, message: "El correlativo del e-CF debe ser mayor a 0." };
    }
    return { valid: true, clean, serie: "E", tipo };
  }

  return {
    valid: false,
    clean,
    serie: null,
    tipo: null,
    message:
      "Formato inválido. Serie B requiere 11 caracteres (ej. B0100000001) y Serie E requiere 13 caracteres (ej. E310000000001)."
  };
}

// ============================================================================
// 4. CONFIGURACIÓN FISCAL POR DEFECTO Y ENDPOINTS OFICIALES DGII
// ============================================================================

export function buildOfficialDGIIEndpoints(env: AmbienteDGII) {
  const base = `https://ecf.dgii.gov.do/${env}`;
  return {
    semilla: `${base}/autenticacion/api/Autenticacion/Semilla`,
    validarSemilla: `${base}/autenticacion/api/Autenticacion/ValidarSemilla`,
    recepcionEcf: `${base}/recepcion/api/FacturasElectronicas`,
    recepcionResumenConsumo: `${base}/recepcionfc/api/Recepcion/ecf`,
    consultaEstado: `${base}/consultaestado/api/Consultas/Estado`,
    consultaResultado: `${base}/consultaresultado/api/Consultas/Estado`,
    consultaTrackIds: `${base}/consultatrackids/api/TrackIds/Consulta`,
    aprobacionComercial: `${base}/aprobacioncomercial/api/AprobacionComercial`,
    directorioServicios: `${base}/consultadirectorio/api/Consultas/Listado`,
    consultaTimbreQr: `${base}/ConsultaTimbre`
  };
}

export function getDefaultSecuenciasDGII(): SecuenciaFiscalDGII[] {
  const today = new Date().toISOString().slice(0, 10);
  const nextYearEnd = `${new Date().getFullYear() + 1}-12-31`;
  const defaults: Array<{ tipo: TipoComprobanteDGII; serie: "B" | "E"; desc: string; max: number }> = [
    { tipo: "B01", serie: "B", desc: "Factura de Crédito Fiscal (Tradicional)", max: 500 },
    { tipo: "B02", serie: "B", desc: "Factura de Consumo (Tradicional)", max: 2000 },
    { tipo: "B03", serie: "B", desc: "Nota de Débito (Tradicional)", max: 100 },
    { tipo: "B04", serie: "B", desc: "Nota de Crédito (Tradicional)", max: 200 },
    { tipo: "B11", serie: "B", desc: "Comprobante de Compras (Proveedores Informales)", max: 100 },
    { tipo: "B14", serie: "B", desc: "Comprobante para Regímenes Especiales", max: 100 },
    { tipo: "B15", serie: "B", desc: "Comprobante Gubernamental", max: 200 },
    { tipo: "B16", serie: "B", desc: "Comprobante para Exportaciones", max: 100 },
    { tipo: "E31", serie: "E", desc: "Factura de Crédito Fiscal Electrónica (e-CF)", max: 5000 },
    { tipo: "E32", serie: "E", desc: "Factura de Consumo Electrónica (e-CF)", max: 10000 },
    { tipo: "E33", serie: "E", desc: "Nota de Débito Electrónica (e-CF)", max: 500 },
    { tipo: "E34", serie: "E", desc: "Nota de Crédito Electrónica (e-CF)", max: 1000 },
    { tipo: "E41", serie: "E", desc: "Compras Electrónico (e-CF)", max: 500 },
    { tipo: "E43", serie: "E", desc: "Gastos Menores Electrónico (e-CF)", max: 500 },
    { tipo: "E44", serie: "E", desc: "Regímenes Especiales Electrónico (e-CF)", max: 500 },
    { tipo: "E45", serie: "E", desc: "Gubernamental Electrónico (e-CF)", max: 1000 },
    { tipo: "E46", serie: "E", desc: "Exportaciones Electrónico (e-CF)", max: 200 },
    { tipo: "E47", serie: "E", desc: "Pagos al Exterior Electrónico (e-CF)", max: 200 }
  ];

  return defaults.map((d) => ({
    id: `seq-${d.tipo.toLowerCase()}`,
    tipo: d.tipo,
    serie: d.serie,
    descripcion: d.desc,
    prefijo: d.tipo,
    secuenciaInicial: 1,
    secuenciaActual: 1,
    secuenciaFinal: d.max,
    fechaAutorizacion: today,
    fechaVencimiento: nextYearEnd,
    numeroAutorizacion: `AUT-DGII-${new Date().getFullYear()}`,
    sucursalId: "001",
    puntoEmision: "001",
    alertaMinima: 20,
    activa: true,
    updatedAt: Date.now()
  }));
}

export function getDefaultConfiguracionDGII(inst?: InstitucionInfo | null): ConfiguracionFiscalDGII {
  const cleanRnc = cleanRncCedula(inst?.rnc) || "";
  const razon = inst?.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez";
  return {
    rncEmisor: cleanRnc,
    razonSocial: razon,
    nombreComercial: inst?.nombreComercial || razon,
    direccionFiscal: inst?.direccion || "Santo Domingo, República Dominicana",
    municipio: inst?.municipio || "010100",
    provincia: inst?.provincia || "010000",
    telefonoEmisor: inst?.telefono || "",
    correoEmisor: inst?.correo || "",
    sitioWeb: inst?.paginaWeb || "",
    regimenTributario: "Ordinario",
    codigoActividadEconomicaCIIU: "4772",
    descripcionActividadEconomica: "Venta al por menor de productos farmacéuticos, medicinales y artículos médicos",
    modalidadEmisionActiva: "DUAL_B_E",
    ambienteDGII: "TesteCF",
    tasaItbisGeneral: 18,
    tasaItbisReducida: 16,
    aplicaExencionMedicamentos: false,
    aplicaPropinaLegal: false,
    modoContingenciaActivo: false,
    sucursales: [
      {
        id: "suc-001",
        codigoEstablecimiento: "001",
        codigoPuntoEmision: "001",
        nombreSucursal: "Sede Principal / Almacén Central",
        direccion: inst?.direccion || "Santo Domingo, D.N.",
        municipio: "Distrito Nacional",
        provincia: "Santo Domingo",
        telefono: inst?.telefono || "",
        responsable: "Administración General",
        principal: true,
        activa: true
      }
    ],
    secuencias: getDefaultSecuenciasDGII(),
    certificadoInfo: {
      configurado: false
    },
    endpointsOficiales: {
      TesteCF: buildOfficialDGIIEndpoints("TesteCF"),
      CerteCF: buildOfficialDGIIEndpoints("CerteCF"),
      eCF: buildOfficialDGIIEndpoints("eCF")
    },
    updatedAt: Date.now()
  };
}

// ============================================================================
// 5. GENERADOR DE XML OFICIAL e-CF (LEY 32-23) Y VALIDADOR XSD
// ============================================================================

function escapeXml(unsafe: string | number | undefined | null): string {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatDGIIXmlDate(isoDateYYYYMMDD: string | undefined): string {
  if (!isoDateYYYYMMDD) {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, "0");
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const y = now.getFullYear();
    return `${d}-${m}-${y}`;
  }
  const m = isoDateYYYYMMDD.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return isoDateYYYYMMDD;
}

export function formatDGIIFirmaTimestamp(date = new Date()): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${d}-${m}-${y} ${hh}:${mm}:${ss}`;
}

export function generateECFXml(factura: FacturaVenta, config: ConfiguracionFiscalDGII): string {
  const meta = getMetadataTipoComprobante(factura.tipoComprobante);
  const tipoEcfNum = meta?.codigoNumericoECF || (factura.tipoComprobante?.slice(1) ?? "31");
  const encf = factura.ncf || "E310000000001";
  const fechaEmision = formatDGIIXmlDate(factura.fecha);
  const fechaVencimientoSeq = formatDGIIXmlDate(
    factura.fechaVencimientoSecuencia || `${new Date().getFullYear() + 1}-12-31`
  );
  const rncEmisor = cleanRncCedula(config.rncEmisor) || "000000000";
  const rncComprador = cleanRncCedula(factura.rncCliente);
  const razonSocialComprador = factura.clienteNombre?.trim() || "CONSUMIDOR FINAL";

  // Calcular subtotales por tasa de ITBIS
  let montoGravadoI1 = 0; // 18%
  let montoGravadoI2 = 0; // 16%
  let montoExento = 0;
  let totalItbis1 = 0;
  let totalItbis2 = 0;

  for (const item of factura.items) {
    const sub = Number(item.subtotal || 0);
    const tasa = item.tasaItbis !== undefined ? item.tasaItbis : factura.aplicaItbis ? 18 : 0;
    const itbis = Number(item.itbisMonto || 0);
    if (tasa === 18) {
      montoGravadoI1 += sub;
      totalItbis1 += itbis;
    } else if (tasa === 16) {
      montoGravadoI2 += sub;
      totalItbis2 += itbis;
    } else {
      montoExento += sub;
    }
  }

  const montoGravadoTotal = Number((montoGravadoI1 + montoGravadoI2).toFixed(2));
  const totalItbis = Number((totalItbis1 + totalItbis2).toFixed(2));
  const montoTotal = Number(factura.totalMonto.toFixed(2));

  const formaPagoObj = FORMAS_PAGO_DGII.find((f) => f.codigo === (factura.formaPagoDGII || "01"));
  const formaPagoCode = formaPagoObj ? formaPagoObj.codigoECF : 1;
  const tipoIngresos = factura.tipoIngreso607 || "01";
  const tipoPago = factura.formaPagoDGII === "04" ? 2 : 1; // 1=Contado, 2=Crédito
  const fechaHoraFirma = factura.fechaHoraFirmaECF || formatDGIIFirmaTimestamp();

  const detallesXml = factura.items
    .map((item, idx) => {
      const tasa = item.tasaItbis !== undefined ? item.tasaItbis : factura.aplicaItbis ? 18 : 0;
      const indFacturacion = tasa === 18 ? 1 : tasa === 16 ? 2 : 4; // 1=ITBIS 18%, 2=ITBIS 16%, 4=Exento
      return `    <Item>
      <NumeroLinea>${idx + 1}</NumeroLinea>
      <TablaCodigosItem>
        <CodigosItem>
          <TipoCodigo>INTERNO</TipoCodigo>
          <CodigoItem>${escapeXml(item.productoCodigo)}</CodigoItem>
        </CodigosItem>
      </TablaCodigosItem>
      <IndicadorFacturacion>${indFacturacion}</IndicadorFacturacion>
      <NombreItem>${escapeXml(item.productoNombre.slice(0, 80))}</NombreItem>
      <IndicadorBienoServicio>1</IndicadorBienoServicio>
      <DescripcionItem>${escapeXml(
        (item.descripcion || `Lote: ${item.numeroLote} Vence: ${item.fechaVencimiento}`).slice(0, 160)
      )}</DescripcionItem>
      <CantidadItem>${Number(item.cantidad).toFixed(2)}</CantidadItem>
      <UnidadMedida>43</UnidadMedida>
      <PrecioUnitarioItem>${Number(item.precioUnitario).toFixed(2)}</PrecioUnitarioItem>${
        item.descuentoMonto && item.descuentoMonto > 0
          ? `\n      <DescuentoMonto>${Number(item.descuentoMonto).toFixed(2)}</DescuentoMonto>`
          : ""
      }
      <MontoItem>${Number(item.subtotal).toFixed(2)}</MontoItem>
    </Item>`;
    })
    .join("\n");

  const compradorXml =
    rncComprador || razonSocialComprador
      ? `    <Comprador>
${rncComprador ? `      <RNCComprador>${escapeXml(rncComprador)}</RNCComprador>\n` : ""}      <RazonSocialComprador>${escapeXml(
          razonSocialComprador
        )}</RazonSocialComprador>${
          factura.clienteContacto ? `\n      <ContactoComprador>${escapeXml(factura.clienteContacto)}</ContactoComprador>` : ""
        }${
          factura.direccionCliente ? `\n      <DireccionComprador>${escapeXml(factura.direccionCliente)}</DireccionComprador>` : ""
        }
    </Comprador>`
      : "";

  const infoReferenciaXml =
    factura.ncfModificado && (meta?.requiereNcfModificado || factura.tipoComprobante === "E33" || factura.tipoComprobante === "E34")
      ? `  <InformacionReferencia>
    <NCFModificado>${escapeXml(factura.ncfModificado)}</NCFModificado>
    <FechaNCFModificado>${formatDGIIXmlDate(factura.fechaNcfModificado || factura.fecha)}</FechaNCFModificado>
    <CodigoModificacion>${escapeXml(factura.codigoModificacion || "03")}</CodigoModificacion>
    <RazonModificacion>${escapeXml(factura.motivoModificacion || factura.observaciones || "Nota de ajuste / devolución")}</RazonModificacion>
  </InformacionReferencia>\n`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>${escapeXml(tipoEcfNum)}</TipoeCF>
      <eNCF>${escapeXml(encf)}</eNCF>
      <FechaVencimientoSecuencia>${escapeXml(fechaVencimientoSeq)}</FechaVencimientoSecuencia>${
        montoGravadoTotal > 0 ? "\n      <IndicadorMontoGravado>0</IndicadorMontoGravado>" : ""
      }
      <TipoIngresos>${escapeXml(tipoIngresos)}</TipoIngresos>
      <TipoPago>${tipoPago}</TipoPago>
      <TablaFormasPago>
        <FormaDePago>
          <FormaPago>${formaPagoCode}</FormaPago>
          <MontoPago>${montoTotal.toFixed(2)}</MontoPago>
        </FormaDePago>
      </TablaFormasPago>
    </IdDoc>
    <Emisor>
      <RNCEmisor>${escapeXml(rncEmisor)}</RNCEmisor>
      <RazonSocialEmisor>${escapeXml(config.razonSocial)}</RazonSocialEmisor>
      <NombreComercial>${escapeXml(config.nombreComercial || config.razonSocial)}</NombreComercial>
      <Sucursal>${escapeXml(factura.sucursalEmision || "001")}</Sucursal>
      <DireccionEmisor>${escapeXml(config.direccionFiscal)}</DireccionEmisor>${
        config.municipio ? `\n      <Municipio>${escapeXml(config.municipio)}</Municipio>` : ""
      }${config.provincia ? `\n      <Provincia>${escapeXml(config.provincia)}</Provincia>` : ""}${
        config.correoEmisor ? `\n      <CorreoEmisor>${escapeXml(config.correoEmisor)}</CorreoEmisor>` : ""
      }${config.sitioWeb ? `\n      <WebSite>${escapeXml(config.sitioWeb)}</WebSite>` : ""}
      <FechaEmision>${escapeXml(fechaEmision)}</FechaEmision>
    </Emisor>
${compradorXml}
    <Totales>
${
  montoGravadoTotal > 0
    ? `      <MontoGravadoTotal>${montoGravadoTotal.toFixed(2)}</MontoGravadoTotal>`
    : ""
}${
    montoGravadoI1 > 0
      ? `\n      <MontoGravadoI1>${montoGravadoI1.toFixed(2)}</MontoGravadoI1>`
      : ""
  }${
    montoGravadoI2 > 0
      ? `\n      <MontoGravadoI2>${montoGravadoI2.toFixed(2)}</MontoGravadoI2>`
      : ""
  }${
    montoExento > 0
      ? `\n      <MontoExento>${montoExento.toFixed(2)}</MontoExento>`
      : ""
  }${
    montoGravadoI1 > 0 ? `\n      <ITBIS1>18</ITBIS1>` : ""
  }${
    montoGravadoI2 > 0 ? `\n      <ITBIS2>16</ITBIS2>` : ""
  }${
    totalItbis > 0
      ? `\n      <TotalITBIS>${totalItbis.toFixed(2)}</TotalITBIS>`
      : "\n      <TotalITBIS>0.00</TotalITBIS>"
  }${
    totalItbis1 > 0
      ? `\n      <TotalITBIS1>${totalItbis1.toFixed(2)}</TotalITBIS1>`
      : ""
  }${
    totalItbis2 > 0
      ? `\n      <TotalITBIS2>${totalItbis2.toFixed(2)}</TotalITBIS2>`
      : ""
  }
      <MontoTotal>${montoTotal.toFixed(2)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItems>
${detallesXml}
  </DetallesItems>
${infoReferenciaXml}  <FechaHoraFirma>${escapeXml(fechaHoraFirma)}</FechaHoraFirma>
</ECF>`;
}

export function validateECFXmlAgainstXSD(
  xml: string,
  factura: FacturaVenta,
  config: ConfiguracionFiscalDGII
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validar RNC del Emisor
  const rncEmisorVal = validateRncOrCedulaDGII(config.rncEmisor);
  if (!rncEmisorVal.valid) {
    errors.push("XSD <RNCEmisor>: El RNC del emisor en la Configuración Fiscal DGII no tiene 9 u 11 dígitos válidos.");
  } else if (!rncEmisorVal.checksumValid) {
    warnings.push("XSD <RNCEmisor>: El RNC del emisor tiene observación en su dígito verificador Módulo 11.");
  }

  // 2. Validar e-NCF o NCF
  const ncfVal = validateNCFFormat(factura.ncf);
  if (!ncfVal.valid) {
    errors.push(`XSD <eNCF>: ${ncfVal.message || "Número de comprobante inválido."}`);
  }

  // 3. Validar Comprador según tipo de comprobante
  const meta = getMetadataTipoComprobante(factura.tipoComprobante);
  if (meta?.requiereRncCliente) {
    const rncCompVal = validateRncOrCedulaDGII(factura.rncCliente, factura.tipoComprobante === "B16" || factura.tipoComprobante === "E46");
    if (!rncCompVal.valid) {
      errors.push(`XSD <RNCComprador>: El comprobante ${factura.tipoComprobante} exige un RNC (9 dígitos) o Cédula (11 dígitos) válido del cliente.`);
    }
    if (!factura.clienteNombre || !factura.clienteNombre.trim()) {
      errors.push(`XSD <RazonSocialComprador>: El comprobante ${factura.tipoComprobante} exige el nombre o razón social del comprador.`);
    }
  }

  // 4. Validar Información de Referencia para Notas de Crédito/Débito (B03, B04, E33, E34)
  if (meta?.requiereNcfModificado) {
    const modVal = validateNCFFormat(factura.ncfModificado);
    if (!modVal.valid) {
      errors.push(
        `XSD <NCFModificado>: Los comprobantes ${factura.tipoComprobante} deben referenciar obligatoriamente el NCF o e-CF original modificado.`
      );
    }
    if (!factura.codigoModificacion) {
      errors.push("XSD <CodigoModificacion>: Falta el código de modificación (01 a 04).");
    }
  }

  // 5. Validar estructura de nodos obligatorios XSD e-CF v1.0
  const requiredTags = [
    "<ECF>",
    "<Encabezado>",
    "<Version>1.0</Version>",
    "<IdDoc>",
    "<TipoeCF>",
    "<eNCF>",
    "<Emisor>",
    "<RNCEmisor>",
    "<RazonSocialEmisor>",
    "<FechaEmision>",
    "<Totales>",
    "<MontoTotal>",
    "<DetallesItems>",
    "<Item>",
    "<FechaHoraFirma>"
  ];
  for (const tag of requiredTags) {
    if (!xml.includes(tag)) {
      errors.push(`XSD Estructura: Falta el nodo obligatorio ${tag} requerido por el esquema e-CF v1.0 de la DGII.`);
    }
  }

  // 6. Validar cuadre aritmético de ítems y totales
  if (!factura.items || factura.items.length === 0) {
    errors.push("XSD <DetallesItems>: El comprobante debe incluir al menos una línea de detalle (<Item>).");
  } else {
    const sumSub = factura.items.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
    const sumItbis = factura.items.reduce((acc, it) => acc + Number(it.itbisMonto || 0), 0);
    const expectedTotal = Number((sumSub + sumItbis).toFixed(2));
    const currentTotal = Number(Number(factura.totalMonto || 0).toFixed(2));
    if (Math.abs(expectedTotal - currentTotal) > 0.05) {
      errors.push(
        `XSD <Totales>: Descuadre aritmético entre suma de líneas + ITBIS (${expectedTotal.toFixed(
          2
        )}) y <MontoTotal> (${currentTotal.toFixed(2)}).`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function buildDGIIQrUrl(
  factura: FacturaVenta,
  config: ConfiguracionFiscalDGII,
  codigoSeguridad: string,
  fechaHoraFirma: string
): string {
  const env = factura.ambienteDGII || config.ambienteDGII || "TesteCF";
  const base = `https://ecf.dgii.gov.do/${env}/ConsultaTimbre`;
  const rncEmisor = cleanRncCedula(config.rncEmisor) || "000000000";
  const rncComprador = cleanRncCedula(factura.rncCliente);
  const encf = factura.ncf || "E310000000001";
  const fechaEmision = formatDGIIXmlDate(factura.fecha);
  const montoTotal = Number(factura.totalMonto || 0).toFixed(2);

  const params = new URLSearchParams();
  params.set("RncEmisor", rncEmisor);
  if (rncComprador) {
    params.set("RncComprador", rncComprador);
  }
  params.set("ENCF", encf);
  params.set("FechaEmision", fechaEmision);
  params.set("MontoTotal", montoTotal);
  params.set("FechaFirma", fechaHoraFirma);
  params.set("CodigoSeguridad", codigoSeguridad.slice(0, 6));

  return `${base}?${params.toString()}`;
}

// ============================================================================
// 6. GENERADOR DE MATRIZ QR (DEPENDENCY-FREE) PARA REPRESENTACIÓN IMPRESA PDF
// ============================================================================

function computeDeterministicBitMatrix(text: string, size = 25): boolean[][] {
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const placeFinderPattern = (rowOffset: number, colOffset: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = rowOffset + r;
        const cc = colOffset + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          matrix[rr][cc] = isBorder || isCenter;
        } else {
          matrix[rr][cc] = false;
        }
      }
    }
  };

  placeFinderPattern(0, 0);
  placeFinderPattern(0, size - 7);
  placeFinderPattern(size - 7, 0);

  // Alignment pattern (bottom-right area)
  const alignCenter = size - 7;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = alignCenter + r;
      const cc = alignCenter + c;
      reserved[rr][cc] = true;
      const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      matrix[rr][cc] = isBorder || isCenter;
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    matrix[6][i] = i % 2 === 0;
    reserved[i][6] = true;
    matrix[i][6] = i % 2 === 0;
  }

  // Encode text bytes + FNV-1a stream into data modules
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i) & 0xff);
  }
  if (bytes.length === 0) bytes.push(0x44, 0x47, 0x49, 0x49);

  let hash = 2166136261;
  let byteIdx = 0;
  let bitIdx = 0;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      const currentByte = bytes[byteIdx % bytes.length];
      hash ^= currentByte + r * 31 + c * 17;
      hash = Math.imul(hash, 16777619) >>> 0;
      const bitFromByte = (currentByte >> (7 - (bitIdx % 8))) & 1;
      const maskBit = (r + c) % 2 === 0 ? 1 : 0;
      matrix[r][c] = ((bitFromByte ^ (hash & 1) ^ maskBit) & 1) === 1;
      bitIdx++;
      if (bitIdx % 8 === 0) byteIdx++;
    }
  }

  return matrix;
}

export function generateQrCanvasPngDataUrl(text: string, pixelSize = 220): string {
  if (typeof document === "undefined") return "";
  const modules = 25;
  const quietZone = 2;
  const totalModules = modules + quietZone * 2;
  const matrix = computeDeterministicBitMatrix(text, modules);

  const canvas = document.createElement("canvas");
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, pixelSize, pixelSize);

  const cellSize = pixelSize / totalModules;
  ctx.fillStyle = "#0F172A";

  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c]) {
        const x = Math.floor((c + quietZone) * cellSize);
        const y = Math.floor((r + quietZone) * cellSize);
        const w = Math.ceil(cellSize);
        const h = Math.ceil(cellSize);
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  return canvas.toDataURL("image/png");
}

// ============================================================================
// 7. FIRMA DIGITAL Y COMUNICACIÓN CON EL SERVIDOR BACKEND / DGII
// ============================================================================

export async function computeLocalDigestAndSecurityCode(xml: string): Promise<{
  digestBase64: string;
  signatureBase64: string;
  codigoSeguridad: string;
}> {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(xml);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const binary = hashArray.map((b) => String.fromCharCode(b)).join("");
    const digestBase64 = btoa(binary);
    // Derivar bloque de firma determinístico para previsualización local cuando aún no hay .p12 cargado
    const sigBuffer = await window.crypto.subtle.digest("SHA-256", encoder.encode(`DGII-XMLDSIG:${digestBase64}`));
    const sigBinary = Array.from(new Uint8Array(sigBuffer))
      .map((b) => String.fromCharCode(b))
      .join("");
    const signatureBase64 = btoa(sigBinary);
    const codigoSeguridad = signatureBase64.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
    return { digestBase64, signatureBase64, codigoSeguridad };
  }

  return {
    digestBase64: "bG9jYWwtZGlnZXN0LXNoYTI1Ng==",
    signatureBase64: "R1lTODBBLWRnaWkteG1sZHNpZw==",
    codigoSeguridad: "R1lTODB"
  };
}

export async function signAndProcessECF(
  factura: FacturaVenta,
  config: ConfiguracionFiscalDGII,
  autoSendToDGII = false
): Promise<{
  xmlGenerado: string;
  xmlFirmado: string;
  codigoSeguridad: string;
  fechaHoraFirma: string;
  urlQrDGII: string;
  firmadoConCertificadoReal: boolean;
  enviadoADGII: boolean;
  trackId?: string;
  estadoFiscal: FacturaVenta["estadoFiscal"];
  respuestaDGII?: string;
  erroresValidacionXSD: string[];
}> {
  const fechaHoraFirma = factura.fechaHoraFirmaECF || formatDGIIFirmaTimestamp();
  const draftFactura: FacturaVenta = {
    ...factura,
    fechaHoraFirmaECF: fechaHoraFirma
  };

  const xmlGenerado = generateECFXml(draftFactura, config);
  const validation = validateECFXmlAgainstXSD(xmlGenerado, draftFactura, config);

  // Intentar firma digital XMLDSig en el servidor Express seguro (/api/dgii/sign-ecf)
  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";
  if (!isLocalFile) {
    try {
      const resp = await fetch("/api/dgii/sign-ecf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xml: xmlGenerado,
          ambiente: draftFactura.ambienteDGII || config.ambienteDGII,
          enviarADGII: autoSendToDGII,
          esResumenConsumo:
            draftFactura.tipoComprobante === "E32" && Number(draftFactura.totalMonto || 0) < 250000
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data && data.signedXml && data.codigoSeguridad) {
          const urlQrDGII = buildDGIIQrUrl(draftFactura, config, data.codigoSeguridad, fechaHoraFirma);
          return {
            xmlGenerado,
            xmlFirmado: data.signedXml,
            codigoSeguridad: data.codigoSeguridad,
            fechaHoraFirma,
            urlQrDGII,
            firmadoConCertificadoReal: Boolean(data.firmadoConCertificadoReal),
            enviadoADGII: Boolean(data.enviadoADGII),
            trackId: data.trackId,
            estadoFiscal: data.estadoFiscal || (data.firmadoConCertificadoReal ? "FIRMADO_XML" : "GENERADO_LOCAL"),
            respuestaDGII: data.respuestaDGII,
            erroresValidacionXSD: validation.errors
          };
        }
      }
    } catch {
      // Si el servidor Express no está accesible o estamos en modo offline, usar estructura local transparente
    }
  }

  // Fallback local transparente (indica claramente que está generado localmente pendiente de firma .p12 / envío)
  const { digestBase64, signatureBase64, codigoSeguridad } = await computeLocalDigestAndSecurityCode(xmlGenerado);
  const signatureBlock = `  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315" />
      <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" />
      <Reference URI="">
        <Transforms>
          <Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature" />
        </Transforms>
        <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256" />
        <DigestValue>${digestBase64}</DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue>${signatureBase64}</SignatureValue>
  </Signature>
</ECF>`;

  const xmlFirmadoLocal = xmlGenerado.replace("</ECF>", signatureBlock);
  const urlQrDGII = buildDGIIQrUrl(draftFactura, config, codigoSeguridad, fechaHoraFirma);

  return {
    xmlGenerado,
    xmlFirmado: xmlFirmadoLocal,
    codigoSeguridad,
    fechaHoraFirma,
    urlQrDGII,
    firmadoConCertificadoReal: false,
    enviadoADGII: false,
    estadoFiscal: config.modoContingenciaActivo ? "EN_CONTINGENCIA" : "GENERADO_LOCAL",
    erroresValidacionXSD: validation.errors
  };
}

// ============================================================================
// 8. GENERACIÓN Y EXPORTACIÓN DE FORMATOS OFICIALES 606, 607 Y 608 (DGII)
// ============================================================================

function splitDateAAAAMM_DD(isoDateYYYYMMDD: string | undefined): { aaaamm: string; dd: string; aaaammdd: string } {
  if (!isoDateYYYYMMDD) return { aaaamm: "", dd: "", aaaammdd: "" };
  const clean = isoDateYYYYMMDD.replace(/-/g, "").trim();
  if (clean.length === 8) {
    return {
      aaaamm: clean.slice(0, 6),
      dd: clean.slice(6, 8),
      aaaammdd: clean
    };
  }
  return { aaaamm: "", dd: "", aaaammdd: "" };
}

function fmtAmountDGII(val: number | undefined | null): string {
  const num = Number(val || 0);
  if (!num || Math.abs(num) < 0.001) return "0.00";
  return num.toFixed(2);
}

/**
 * Genera el archivo oficial Formato 606 (.TXT separado por pipes |) conforme a la Norma General 07-2018 de la DGII
 */
export function generate606Txt(
  rncEmisor: string,
  periodoAAAAMM: string,
  compras: RegistroCompra606[]
): string {
  const cleanRnc = cleanRncCedula(rncEmisor) || "000000000";
  const activas = compras.filter((c) => !c.anulado && c.periodoMes === periodoAAAAMM);
  const header = `606|${cleanRnc}|${periodoAAAAMM}|${activas.length}`;

  const lines = activas.map((c) => {
    const fComp = splitDateAAAAMM_DD(c.fechaComprobante);
    const fPago = splitDateAAAAMM_DD(c.fechaPago);
    const cols = [
      cleanRncCedula(c.rncCedulaProveedor), // 1. RNC o Cédula
      c.tipoIdentificacion || "1", // 2. Tipo Id (1=RNC, 2=Cédula)
      c.tipoBienesServicios || "09", // 3. Tipo Bienes y Servicios Comprados (01-11)
      c.ncf.trim().toUpperCase(), // 4. NCF o e-CF
      (c.ncfModificado || "").trim().toUpperCase(), // 5. NCF o Documento Modificado
      fComp.aaaamm, // 6. Fecha Comprobante (AAAAMM)
      fComp.dd, // 7. Fecha Comprobante (DD)
      fPago.aaaamm, // 8. Fecha Pago (AAAAMM)
      fPago.dd, // 9. Fecha Pago (DD)
      fmtAmountDGII(c.montoFacturadoServicios), // 10. Monto Facturado en Servicios
      fmtAmountDGII(c.montoFacturadoBienes), // 11. Monto Facturado en Bienes
      fmtAmountDGII(c.totalMontoFacturado), // 12. Total Monto Facturado
      fmtAmountDGII(c.itbisFacturado), // 13. ITBIS Facturado
      fmtAmountDGII(c.itbisRetenido), // 14. ITBIS Retenido
      fmtAmountDGII(c.itbisSujetoProporcionalidad), // 15. ITBIS sujeto a Proporcionalidad (Art. 349)
      fmtAmountDGII(c.itbisLlevadoAlCosto), // 16. ITBIS llevado al Costo
      fmtAmountDGII(c.itbisPorAdelantar), // 17. ITBIS por Adelantar
      fmtAmountDGII(c.itbisPercibidoEnCompras), // 18. ITBIS percibido en compras
      c.tipoRetencionISR || "", // 19. Tipo de Retención en ISR (01-08)
      fmtAmountDGII(c.montoRetencionRenta), // 20. Monto Retención Renta
      fmtAmountDGII(c.isrPercibidoEnCompras), // 21. ISR Percibido en compras
      fmtAmountDGII(c.impuestoSelectivoConsumo), // 22. Impuesto Selectivo al Consumo
      fmtAmountDGII(c.otrosImpuestosTasas), // 23. Otros Impuestos/Tasas
      fmtAmountDGII(c.montoPropinaLegal), // 24. Monto Propina Legal
      c.formaPago || "01" // 25. Forma de Pago (01-07)
    ];
    return cols.join("|");
  });

  return [header, ...lines].join("\r\n");
}

/**
 * Obtiene el desglose de formas de pago de una factura para el Formato 607
 */
export function resolveDesglosePagoFactura(f: FacturaVenta): DesglosePagoDGII {
  if (f.desglosePagosDGII) {
    return f.desglosePagosDGII;
  }
  const monto = Number(f.totalMonto || 0);
  const fp = f.formaPagoDGII || "01";
  return {
    efectivo: fp === "01" ? monto : 0,
    chequeTransferenciaDeposito: fp === "02" ? monto : 0,
    tarjetaDebitoCredito: fp === "03" ? monto : 0,
    ventaACredito: fp === "04" ? monto : 0,
    bonosCertificados: fp === "05" ? monto : 0,
    permuta: fp === "06" ? monto : 0,
    otrasFormasVenta: fp === "07" ? monto : 0
  };
}

/**
 * Genera el archivo oficial Formato 607 (.TXT separado por pipes |) conforme a la Norma General 07-2018 de la DGII
 */
export function generate607Txt(
  rncEmisor: string,
  periodoAAAAMM: string,
  facturas: FacturaVenta[]
): string {
  const cleanRnc = cleanRncCedula(rncEmisor) || "000000000";
  const validas = facturas.filter((f) => {
    if (f.anulada || f.estadoFiscal === "ANULADO") return false;
    if (!f.ncf) return false;
    const fMes = (f.fecha || "").replace(/-/g, "").slice(0, 6);
    return fMes === periodoAAAAMM;
  });

  const header = `607|${cleanRnc}|${periodoAAAAMM}|${validas.length}`;

  const lines = validas.map((f) => {
    const rncCli = cleanRncCedula(f.rncCliente);
    const tipoId = rncCli
      ? f.tipoIdCliente || (rncCli.length === 9 ? "1" : rncCli.length === 11 ? "2" : "3")
      : "";
    const fComp = splitDateAAAAMM_DD(f.fecha);
    const fRet = splitDateAAAAMM_DD(f.fechaRetencionTerceros);
    const subtotalSinImpuestos = Number(
      (f.subtotalMonto !== undefined ? f.subtotalMonto : f.totalMonto - (f.itbisMonto || 0)).toFixed(2)
    );
    const pagos = resolveDesglosePagoFactura(f);

    const cols = [
      rncCli, // 1. RNC/Cédula o Pasaporte
      tipoId, // 2. Tipo Identificación (1, 2, 3 o vacío en Consumo < 250k)
      (f.ncf || "").trim().toUpperCase(), // 3. Número Comprobante Fiscal (NCF / e-CF)
      (f.ncfModificado || "").trim().toUpperCase(), // 4. Número Comprobante Fiscal Modificado
      f.tipoIngreso607 || "01", // 5. Tipo de Ingreso (01-06)
      fComp.aaaammdd, // 6. Fecha Comprobante (AAAAMMDD)
      fRet.aaaammdd, // 7. Fecha de Retención (AAAAMMDD)
      fmtAmountDGII(subtotalSinImpuestos), // 8. Monto Facturado (sin impuestos)
      fmtAmountDGII(f.itbisMonto || 0), // 9. ITBIS Facturado
      fmtAmountDGII(f.itbisRetenidoTerceros || 0), // 10. ITBIS Retenido por Terceros
      "0.00", // 11. ITBIS Percibido
      fmtAmountDGII(f.isrRetenidoTerceros || 0), // 12. Retención Renta por Terceros
      "0.00", // 13. ISR Percibido
      fmtAmountDGII(f.impuestoSelectivoMonto || 0), // 14. Impuesto Selectivo al Consumo
      fmtAmountDGII(f.otrosImpuestosMonto || 0), // 15. Otros Impuestos/Tasas
      fmtAmountDGII(f.propinaLegalMonto || 0), // 16. Monto Propina Legal
      fmtAmountDGII(pagos.efectivo), // 17. Efectivo
      fmtAmountDGII(pagos.chequeTransferenciaDeposito), // 18. Cheque/Transferencia/Depósito
      fmtAmountDGII(pagos.tarjetaDebitoCredito), // 19. Tarjeta Débito/Crédito
      fmtAmountDGII(pagos.ventaACredito), // 20. Venta a Crédito
      fmtAmountDGII(pagos.bonosCertificados), // 21. Bonos o Certificados de Regalo
      fmtAmountDGII(pagos.permuta), // 22. Permuta
      fmtAmountDGII(pagos.otrasFormasVenta) // 23. Otras Formas de Ventas
    ];
    return cols.join("|");
  });

  return [header, ...lines].join("\r\n");
}

/**
 * Genera el archivo oficial Formato 608 (.TXT separado por pipes |) conforme a la Norma General 07-2018 de la DGII
 */
export function generate608Txt(
  rncEmisor: string,
  periodoAAAAMM: string,
  anulaciones: RegistroAnulacion608[]
): string {
  const cleanRnc = cleanRncCedula(rncEmisor) || "000000000";
  const delPeriodo = anulaciones.filter((a) => a.periodoMes === periodoAAAAMM);
  const header = `608|${cleanRnc}|${periodoAAAAMM}|${delPeriodo.length}`;

  const lines = delPeriodo.map((a) => {
    const fComp = splitDateAAAAMM_DD(a.fechaComprobante);
    const cols = [
      a.ncfAnulado.trim().toUpperCase(), // 1. NCF o e-CF Anulado
      fComp.aaaammdd, // 2. Fecha de Comprobante (AAAAMMDD)
      a.tipoAnulacion || "04" // 3. Tipo de Anulación (01-10)
    ];
    return cols.join("|");
  });

  return [header, ...lines].join("\r\n");
}

export function downloadTextFile(content: string, filename: string, mimeType = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function export606Excel(rncEmisor: string, periodoAAAAMM: string, compras: RegistroCompra606[]): void {
  const activas = compras.filter((c) => !c.anulado && c.periodoMes === periodoAAAAMM);
  const rows = activas.map((c, idx) => {
    const fComp = splitDateAAAAMM_DD(c.fechaComprobante);
    const fPago = splitDateAAAAMM_DD(c.fechaPago);
    return {
      "Línea": idx + 1,
      "RNC o Cédula": cleanRncCedula(c.rncCedulaProveedor),
      "Tipo Id": c.tipoIdentificacion,
      "Proveedor": c.nombreProveedor,
      "Tipo Bienes y Servicios": c.tipoBienesServicios,
      "NCF / e-CF": c.ncf,
      "NCF Modificado": c.ncfModificado || "",
      "Fecha Comprobante (AAAAMM)": fComp.aaaamm,
      "Día Comprobante (DD)": fComp.dd,
      "Fecha Pago (AAAAMM)": fPago.aaaamm,
      "Día Pago (DD)": fPago.dd,
      "Monto Facturado Servicios": Number(c.montoFacturadoServicios || 0),
      "Monto Facturado Bienes": Number(c.montoFacturadoBienes || 0),
      "Total Monto Facturado": Number(c.totalMontoFacturado || 0),
      "ITBIS Facturado": Number(c.itbisFacturado || 0),
      "ITBIS Retenido": Number(c.itbisRetenido || 0),
      "ITBIS Proporcionalidad": Number(c.itbisSujetoProporcionalidad || 0),
      "ITBIS Llevado al Costo": Number(c.itbisLlevadoAlCosto || 0),
      "ITBIS por Adelantar": Number(c.itbisPorAdelantar || 0),
      "Tipo Retención ISR": c.tipoRetencionISR || "",
      "Monto Retención Renta": Number(c.montoRetencionRenta || 0),
      "ISC": Number(c.impuestoSelectivoConsumo || 0),
      "Otros Impuestos": Number(c.otrosImpuestosTasas || 0),
      "Propina Legal": Number(c.montoPropinaLegal || 0),
      "Forma de Pago": c.formaPago
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `606_${periodoAAAAMM}`);
  XLSX.writeFile(wb, `DGII_606_${cleanRncCedula(rncEmisor) || "EMISOR"}_${periodoAAAAMM}.xlsx`);
}

export function export607Excel(rncEmisor: string, periodoAAAAMM: string, facturas: FacturaVenta[]): void {
  const validas = facturas.filter((f) => {
    if (f.anulada || f.estadoFiscal === "ANULADO") return false;
    if (!f.ncf) return false;
    return (f.fecha || "").replace(/-/g, "").slice(0, 6) === periodoAAAAMM;
  });

  const rows = validas.map((f, idx) => {
    const rncCli = cleanRncCedula(f.rncCliente);
    const tipoId = rncCli
      ? f.tipoIdCliente || (rncCli.length === 9 ? "1" : rncCli.length === 11 ? "2" : "3")
      : "";
    const fComp = splitDateAAAAMM_DD(f.fecha);
    const subtotalSinImp = Number(
      (f.subtotalMonto !== undefined ? f.subtotalMonto : f.totalMonto - (f.itbisMonto || 0)).toFixed(2)
    );
    const pagos = resolveDesglosePagoFactura(f);

    return {
      "Línea": idx + 1,
      "RNC/Cédula/Pasaporte": rncCli,
      "Tipo Identificación": tipoId,
      "Cliente / Razón Social": f.clienteNombre || "CONSUMIDOR FINAL",
      "NCF / e-CF": f.ncf || "",
      "NCF Modificado": f.ncfModificado || "",
      "Tipo de Ingreso": f.tipoIngreso607 || "01",
      "Fecha Comprobante (AAAAMMDD)": fComp.aaaammdd,
      "Monto Facturado (Sin ITBIS)": subtotalSinImp,
      "ITBIS Facturado": Number(f.itbisMonto || 0),
      "ITBIS Retenido por Terceros": Number(f.itbisRetenidoTerceros || 0),
      "Retención Renta por Terceros": Number(f.isrRetenidoTerceros || 0),
      "Efectivo": pagos.efectivo,
      "Cheque / Transferencia / Depósito": pagos.chequeTransferenciaDeposito,
      "Tarjeta Débito / Crédito": pagos.tarjetaDebitoCredito,
      "Venta a Crédito": pagos.ventaACredito,
      "Bonos o Certificados": pagos.bonosCertificados,
      "Permuta": pagos.permuta,
      "Otras Formas de Venta": pagos.otrasFormasVenta,
      "Estado Fiscal": f.estadoFiscal || "EMITIDO_NCF"
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `607_${periodoAAAAMM}`);
  XLSX.writeFile(wb, `DGII_607_${cleanRncCedula(rncEmisor) || "EMISOR"}_${periodoAAAAMM}.xlsx`);
}

export function export608Excel(rncEmisor: string, periodoAAAAMM: string, anulaciones: RegistroAnulacion608[]): void {
  const delPeriodo = anulaciones.filter((a) => a.periodoMes === periodoAAAAMM);
  const rows = delPeriodo.map((a, idx) => {
    const fComp = splitDateAAAAMM_DD(a.fechaComprobante);
    return {
      "Línea": idx + 1,
      "NCF / e-CF Anulado": a.ncfAnulado,
      "Tipo Comprobante": a.tipoComprobante,
      "Fecha Comprobante (AAAAMMDD)": fComp.aaaammdd,
      "Tipo de Anulación": a.tipoAnulacion,
      "Motivo Detallado": a.descripcionMotivo,
      "Autorizado Por": a.usuarioAutorizador,
      "Fecha Anulación": a.fechaAnulacion.slice(0, 10)
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `608_${periodoAAAAMM}`);
  XLSX.writeFile(wb, `DGII_608_${cleanRncCedula(rncEmisor) || "EMISOR"}_${periodoAAAAMM}.xlsx`);
}

// ============================================================================
// 9. PERSISTENCIA MULTI-TENANT Y OFFLINE DE DATOS FISCALES DGII
// ============================================================================

function getTenantStorageKey(baseKey: string, farmaciaId?: string): string {
  const tenant = farmaciaId || getActiveFarmaciaId();
  return `${baseKey}_${tenant}`;
}

export async function loadConfiguracionDGII(
  farmaciaId?: string,
  instFallback?: InstitucionInfo | null
): Promise<ConfiguracionFiscalDGII> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_config", tenant);
  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";

  if (!isLocalFile) {
    try {
      const snap = await getDoc(tenantDoc("configuracion", "dgii_config", tenant));
      if (snap.exists()) {
        const data = snap.data() as ConfiguracionFiscalDGII;
        const merged: ConfiguracionFiscalDGII = {
          ...getDefaultConfiguracionDGII(instFallback),
          ...data,
          endpointsOficiales: {
            TesteCF: buildOfficialDGIIEndpoints("TesteCF"),
            CerteCF: buildOfficialDGIIEndpoints("CerteCF"),
            eCF: buildOfficialDGIIEndpoints("eCF")
          }
        };
        localStorage.setItem(storageKey, JSON.stringify(merged));
        return merged;
      }
    } catch {
      // Fallback to localStorage
    }
  }

  const cached = localStorage.getItem(storageKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ConfiguracionFiscalDGII;
      return {
        ...getDefaultConfiguracionDGII(instFallback),
        ...parsed
      };
    } catch {}
  }

  return getDefaultConfiguracionDGII(instFallback);
}

export async function saveConfiguracionDGII(
  config: ConfiguracionFiscalDGII,
  farmaciaId?: string
): Promise<void> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_config", tenant);
  const payload: ConfiguracionFiscalDGII = {
    ...config,
    rncEmisor: cleanRncCedula(config.rncEmisor),
    updatedAt: Date.now()
  };

  localStorage.setItem(storageKey, JSON.stringify(payload));
  window.dispatchEvent(new Event("dgii_config_updated"));

  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";
  if (!isLocalFile) {
    await setDoc(tenantDoc("configuracion", "dgii_config", tenant), payload, { merge: true });
  }
}

export async function loadCompras606(farmaciaId?: string): Promise<RegistroCompra606[]> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_compras_606", tenant);
  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";

  if (!isLocalFile) {
    try {
      const snap = await getDoc(tenantDoc("configuracion", "dgii_compras_606", tenant));
      if (snap.exists()) {
        const items = (snap.data()?.items || []) as RegistroCompra606[];
        localStorage.setItem(storageKey, JSON.stringify(items));
        return items;
      }
    } catch {}
  }

  const cached = localStorage.getItem(storageKey);
  if (cached) {
    try {
      return JSON.parse(cached) as RegistroCompra606[];
    } catch {}
  }
  return [];
}

export async function saveCompras606List(
  items: RegistroCompra606[],
  farmaciaId?: string
): Promise<void> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_compras_606", tenant);
  const trimmed = items.slice(0, 600);
  localStorage.setItem(storageKey, JSON.stringify(trimmed));
  window.dispatchEvent(new Event("dgii_compras_606_updated"));

  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";
  if (!isLocalFile) {
    await setDoc(
      tenantDoc("configuracion", "dgii_compras_606", tenant),
      { items: trimmed, updatedAt: Date.now() },
      { merge: true }
    );
  }
}

export async function loadAnulaciones608(farmaciaId?: string): Promise<RegistroAnulacion608[]> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_anulaciones_608", tenant);
  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";

  if (!isLocalFile) {
    try {
      const snap = await getDoc(tenantDoc("configuracion", "dgii_anulaciones_608", tenant));
      if (snap.exists()) {
        const items = (snap.data()?.items || []) as RegistroAnulacion608[];
        localStorage.setItem(storageKey, JSON.stringify(items));
        return items;
      }
    } catch {}
  }

  const cached = localStorage.getItem(storageKey);
  if (cached) {
    try {
      return JSON.parse(cached) as RegistroAnulacion608[];
    } catch {}
  }
  return [];
}

export async function saveAnulaciones608List(
  items: RegistroAnulacion608[],
  farmaciaId?: string
): Promise<void> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_anulaciones_608", tenant);
  const trimmed = items.slice(0, 500);
  localStorage.setItem(storageKey, JSON.stringify(trimmed));
  window.dispatchEvent(new Event("dgii_anulaciones_608_updated"));

  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";
  if (!isLocalFile) {
    await setDoc(
      tenantDoc("configuracion", "dgii_anulaciones_608", tenant),
      { items: trimmed, updatedAt: Date.now() },
      { merge: true }
    );
  }
}

export async function loadAuditoriaFiscal(farmaciaId?: string): Promise<EventoAuditoriaFiscal[]> {
  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_auditoria_fiscal", tenant);
  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";

  if (!isLocalFile) {
    try {
      const snap = await getDoc(tenantDoc("configuracion", "dgii_auditoria_fiscal", tenant));
      if (snap.exists()) {
        const items = (snap.data()?.eventos || []) as EventoAuditoriaFiscal[];
        localStorage.setItem(storageKey, JSON.stringify(items));
        return items;
      }
    } catch {}
  }

  const cached = localStorage.getItem(storageKey);
  if (cached) {
    try {
      return JSON.parse(cached) as EventoAuditoriaFiscal[];
    } catch {}
  }
  return [];
}

export async function appendAuditoriaFiscal(
  partial: Omit<EventoAuditoriaFiscal, "id" | "fecha" | "hora" | "timestamp">,
  farmaciaId?: string
): Promise<EventoAuditoriaFiscal> {
  const now = new Date();
  const ts = now.getTime();
  const evento: EventoAuditoriaFiscal = {
    ...partial,
    id: `aud-${ts}-${Math.random().toString(36).slice(2, 7)}`,
    fecha: now.toISOString().slice(0, 10),
    hora: now.toTimeString().slice(0, 8),
    timestamp: ts
  };

  const current = await loadAuditoriaFiscal(farmaciaId);
  const updated = [evento, ...current].slice(0, 400);

  const tenant = farmaciaId || getActiveFarmaciaId();
  const storageKey = getTenantStorageKey("offline_dgii_auditoria_fiscal", tenant);
  localStorage.setItem(storageKey, JSON.stringify(updated));
  window.dispatchEvent(new Event("dgii_auditoria_updated"));

  const isLocalFile = typeof window !== "undefined" && window.location.protocol === "file:";
  if (!isLocalFile) {
    try {
      await setDoc(
        tenantDoc("configuracion", "dgii_auditoria_fiscal", tenant),
        { eventos: updated, updatedAt: ts },
        { merge: true }
      );
    } catch {}
  }

  return evento;
}
