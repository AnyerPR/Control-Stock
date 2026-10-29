export interface Lote {
  id: string;
  numeroLote: string;
  cantidad: number;
  cantidadF: number; // Cantidad física
  fechaVencimiento: string; // YYYY-MM-DD
  precio: number;
  loteFisico?: string; // Ubicación física
  fechaFisica?: string; // Fecha de vencimiento física
  articuloAjustado?: boolean; // Indica si se completó el ajuste
}

export interface Catalogo {
  id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean;
  createdAt: number;
}

export interface Producto {
  codigo: string;
  nombre: string;
  descripcion?: string;
  imagen?: string;
  imagenURL?: string;
  verificado?: boolean;
  lotes: Lote[];
  updatedAt: number;
  catalogId?: string;
}

export interface Movimiento {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  descripcion?: string;
  lote: string;
  loteFisico?: string;
  cantidad: number;
  cantidadF?: number;
  fechaVencimiento?: string;
  fechaFisica?: string;
  precio: number;
  tipoMovimiento: "Entrada" | "Salida" | "Ajuste";
  usuario: string; // Nombre (usuario)
  fecha: string; // ISO string
  timestamp: number;
  catalogId?: string;
  numeroFactura?: string;
  fechaEntrada?: string; // YYYY-MM-DD
  proveedor?: string;
}

export interface Usuario {
  id: string;
  nombre: string;
  usuario: string;
  contrasenaHash: string;
  rol: "Administrador" | "Operador";
  estado: "Activo" | "Inactivo";
  updatedAt: number;
  departamento: string;
  modulos?: string[];
  catalogos?: string[]; // IDs de catálogos habilitados
  farmaciaId?: string;
  authUid?: string;
}

export interface CampoVariableCliente {
  etiqueta: string;
  valor: string;
}

export interface InstitucionInfo {
  nombre: string; // Razón social / Nombre de la Institución / Empresa
  subtitulo?: string;
  rnc?: string; // RNC / NIT / ID Fiscal
  telefono?: string;
  correo?: string;
  paginaWeb?: string;
  direccion?: string;
  piePagina?: string; // Información adicional (Pie de página de facturas)
  logoUrl?: string; // Base64 o URL del logotipo institucional
  camposExtra?: CampoVariableCliente[];
  updatedAt?: number;
}

export interface FarmaciaTenant extends InstitucionInfo {
  id: string; // código único ej: "principal", "farmacia-central"
  activa: boolean;
  adminUsuario: string;
  createdAt: number;
}

export interface ConceptoFactura {
  id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean;
  createdAt: number;
}

export const DEFAULT_CONCEPTOS_FACTURA: ConceptoFactura[] = [
  {
    id: "conc-venta",
    nombre: "Venta",
    descripcion: "Facturación general de medicamentos, insumos y artículos",
    activo: true,
    createdAt: 1700000000000
  },
  {
    id: "conc-compra",
    nombre: "Compra",
    descripcion: "Operación por concepto de compra o adquisición",
    activo: true,
    createdAt: 1700000001000
  },
  {
    id: "conc-transferencia",
    nombre: "Transferencia",
    descripcion: "Traslado o transferencia de suministros entre áreas o sedes",
    activo: true,
    createdAt: 1700000002000
  },
  {
    id: "conc-donacion",
    nombre: "Donación",
    descripcion: "Entrega o despacho en calidad de donación institucional",
    activo: true,
    createdAt: 1700000003000
  },
  {
    id: "conc-consumo",
    nombre: "Consumo Interno",
    descripcion: "Despacho para uso interno del centro o departamento",
    activo: true,
    createdAt: 1700000004000
  }
];

export interface VentaItem {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  descripcion?: string;
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  aplicaItbis?: boolean;
  itbisMonto?: number;
  totalItem?: number;
}

export interface FacturaVenta {
  id: string;
  numeroFactura: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  timestamp: number;
  concepto: string; // Compra, Transferencia, Donación, Venta, etc.
  clienteNombre?: string; // Opcional
  clienteContacto?: string; // Opcional
  observaciones?: string;
  catalogId: string;
  catalogNombre?: string;
  usuarioResponsable: string;
  items: VentaItem[];
  totalUnidades: number;
  subtotalMonto?: number;
  aplicaItbis?: boolean;
  itbisMonto?: number;
  totalMonto: number;
}

export const ALL_SYSTEM_MODULES = [
  "dashboard",
  "inventory",
  "venta",
  "carga_masiva",
  "solicitudes",
  "historial",
  "usuarios",
  "configuracion"
] as const;

export function getEnabledModules(user: Usuario | null | undefined): string[] {
  if (!user) return [];
  if (user.modulos && Array.isArray(user.modulos)) {
    // Respetar estrictamente los módulos asignados al usuario sin inyectar "venta" ni otros módulos no autorizados
    return user.modulos.filter(Boolean);
  }
  if (user.rol === "Administrador") {
    if (user.usuario?.toLowerCase() === "anyer") {
      return ["inventory", "venta", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"];
    }
    return ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"];
  }
  return ["solicitudes", "historial"];
}

export function isModuleAuthorized(user: Usuario | null | undefined, moduleId: string): boolean {
  if (!user) return false;
  if (moduleId === "dashboard") return true;
  const enabled = getEnabledModules(user);
  return enabled.includes(moduleId);
}

export function resolveModuleFromSlug(rawSlug: string | null | undefined): string | null {
  if (!rawSlug) return null;
  const clean = rawSlug
    .trim()
    .toLowerCase()
    .replace(/^[#/?]+/, "")
    .split(/[/?&#]/)[0];

  const map: Record<string, string> = {
    dashboard: "dashboard",
    inicio: "dashboard",
    resumen: "dashboard",
    panel: "dashboard",
    inventory: "inventory",
    inventario: "inventory",
    suministros: "inventory",
    stock: "inventory",
    venta: "venta",
    ventas: "venta",
    facturacion: "venta",
    factura: "venta",
    carga_masiva: "carga_masiva",
    "carga-masiva": "carga_masiva",
    importar: "carga_masiva",
    solicitudes: "solicitudes",
    ordenes: "solicitudes",
    pedidos: "solicitudes",
    historial: "historial",
    movimientos: "historial",
    usuarios: "usuarios",
    personal: "usuarios",
    configuracion: "configuracion",
    configurar: "configuracion",
    ajustes: "configuracion"
  };

  return map[clean] || null;
}

function normalizeCatalogToken(val: string | undefined | null): string {
  return String(val || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCanonicalCatalogKey(idOrName: string | undefined | null): string {
  const clean = normalizeCatalogToken(idOrName);
  if (!clean || clean === "default-cat" || clean === "medicamentos e insumos" || clean.startsWith("cat-medicamentos")) {
    return "default-cat";
  }
  if (clean === "laboratorio" || clean.startsWith("cat-laboratorio") || clean.includes("laboratorio")) {
    return "laboratorio";
  }
  if (clean === "odontologia" || clean.startsWith("cat-odontologia") || clean.includes("odontologia")) {
    return "odontologia";
  }
  return clean;
}

export function matchesCatalog(
  itemCatalogId: string | undefined | null,
  targetCatalogId: string | undefined | null,
  catalogos?: Catalogo[] | null
): boolean {
  const rawItem = (itemCatalogId || "default-cat").trim();
  const rawTarget = (targetCatalogId || "default-cat").trim();
  if (!rawTarget || rawTarget === "todos") return true;
  if (rawItem === rawTarget || normalizeCatalogToken(rawItem) === normalizeCatalogToken(rawTarget)) {
    return true;
  }

  const itemCanonical = getCanonicalCatalogKey(rawItem);
  const targetCanonical = getCanonicalCatalogKey(rawTarget);
  if (
    (itemCanonical === "laboratorio" || itemCanonical === "odontologia" || itemCanonical === "default-cat") &&
    itemCanonical === targetCanonical
  ) {
    return true;
  }

  if (catalogos && catalogos.length > 0) {
    const targetCat = catalogos.find(
      (c) =>
        c.id === rawTarget ||
        normalizeCatalogToken(c.id) === normalizeCatalogToken(rawTarget) ||
        normalizeCatalogToken(c.nombre) === normalizeCatalogToken(rawTarget)
    );
    if (targetCat) {
      const catIdNorm = normalizeCatalogToken(targetCat.id);
      const catNameNorm = normalizeCatalogToken(targetCat.nombre);
      const itemNorm = normalizeCatalogToken(rawItem);
      if (itemNorm === catIdNorm || itemNorm === catNameNorm) {
        return true;
      }
      const catCanonical = getCanonicalCatalogKey(targetCat.id !== "default-cat" ? targetCat.nombre : targetCat.id);
      if (
        (catCanonical === "laboratorio" || catCanonical === "odontologia" || catCanonical === "default-cat") &&
        itemCanonical === catCanonical
      ) {
        return true;
      }
    }
  }

  return false;
}

export function getUserAvailableCatalogos(
  user: Usuario | null | undefined,
  catalogos: Catalogo[] | null | undefined
): Catalogo[] {
  const activeCatalogos = (catalogos || []).filter((c) => c && c.activo !== false);
  if (activeCatalogos.length === 0) {
    return [
      {
        id: "default-cat",
        nombre: "Medicamentos e Insumos",
        activo: true,
        createdAt: Date.now()
      }
    ];
  }
  if (!user) return activeCatalogos;

  // Administradores sin restricción explícita o SuperAdmin ven todos los catálogos activos
  if (user.rol === "Administrador" && (!user.catalogos || user.catalogos.length === 0)) {
    return activeCatalogos;
  }

  const userCats = Array.isArray(user.catalogos) ? user.catalogos.filter(Boolean) : [];
  const isRossy =
    user.usuario?.toLowerCase().includes("rossy") ||
    user.nombre?.toLowerCase().includes("rossy");
  const isLabDept = normalizeCatalogToken(user.departamento) === "laboratorio";

  if (userCats.length > 0) {
    const matched = activeCatalogos.filter((c) =>
      userCats.some(
        (uc) =>
          uc === c.id ||
          normalizeCatalogToken(uc) === normalizeCatalogToken(c.id) ||
          normalizeCatalogToken(uc) === normalizeCatalogToken(c.nombre) ||
          matchesCatalog(uc, c.id, activeCatalogos)
      )
    );

    // Garantizar que si un usuario pertenece al departamento de Laboratorio y tiene "laboratorio" en sus catálogos
    // o su departamento es Laboratorio, el catálogo de Laboratorio esté siempre incluido si existe activo
    if (isLabDept) {
      const labCat = activeCatalogos.find(
        (c) =>
          c.id === "laboratorio" ||
          normalizeCatalogToken(c.nombre).includes("laboratorio") ||
          normalizeCatalogToken(c.id).includes("laboratorio")
      );
      if (labCat && !matched.some((m) => m.id === labCat.id)) {
        matched.unshift(labCat);
      }
    }

    // Garantizar que si Rossy tenía solo 1 catálogo sincronizado por restricción previa de Laboratorio,
    // pueda seleccionar tanto su catálogo de Laboratorio como el segundo catálogo habilitado (ej. Medicamentos e Insumos)
    if (isRossy && matched.length < 2 && activeCatalogos.length >= 2) {
      const labAndDefault = activeCatalogos.filter(
        (c) =>
          matched.some((m) => m.id === c.id) ||
          c.id === "laboratorio" ||
          c.id === "default-cat" ||
          normalizeCatalogToken(c.nombre).includes("laboratorio") ||
          normalizeCatalogToken(c.nombre).includes("medicamentos")
      );
      if (labAndDefault.length >= 2) {
        return labAndDefault;
      }
      return activeCatalogos;
    }

    if (matched.length > 0) {
      return matched;
    }
  }

  // Si no tiene catálogos restringidos en user.catalogos, permitir todos los catálogos activos,
  // priorizando el catálogo de su departamento (ej. Laboratorio) al inicio de la lista
  if (isLabDept) {
    return [...activeCatalogos].sort((a, b) => {
      const aIsLab =
        a.id === "laboratorio" || normalizeCatalogToken(a.nombre).includes("laboratorio") ? 1 : 0;
      const bIsLab =
        b.id === "laboratorio" || normalizeCatalogToken(b.nombre).includes("laboratorio") ? 1 : 0;
      return bIsLab - aIsLab;
    });
  }

  return activeCatalogos;
}

export function isCatalogAllowedForUser(
  user: Usuario | null | undefined,
  catalogId: string | undefined | null,
  catalogos: Catalogo[] | null | undefined
): boolean {
  if (!user) return false;
  if (user.rol === "Administrador" && (!user.catalogos || user.catalogos.length === 0)) {
    return true;
  }
  const targetId = (catalogId || "default-cat").trim();
  if (catalogos && catalogos.length > 0) {
    const allowed = getUserAvailableCatalogos(user, catalogos);
    return allowed.some((c) => matchesCatalog(targetId, c.id, catalogos));
  }
  const userCats = Array.isArray(user.catalogos) ? user.catalogos.filter(Boolean) : [];
  if (userCats.length === 0) return true;
  if (
    normalizeCatalogToken(user.departamento) === "laboratorio" &&
    getCanonicalCatalogKey(targetId) === "laboratorio"
  ) {
    return true;
  }
  return userCats.some((uc) => matchesCatalog(targetId, uc));
}

export interface Departamento {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: number;
}

export interface CambioEstado {
  estado: "Pendiente" | "Aprobada" | "Rechazada" | "En Proceso" | "Entregada" | "En proceso" | "Completada" | "En preparación" | "Parcialmente entregada" | "Cancelada";
  usuarioResponsable: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
}

export interface DespachoLote {
  loteId: string;
  loteNumero: string;
  cantidad: number;
}

export interface SolicitudItem {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  cantidadSolicitada: number;
  cantidadAprobada?: number;
  cantidadEntregada: number;
  motivoDiferencia?: string;
  loteId?: string;
  loteNumero?: string;
  despachoLotes?: DespachoLote[];
}

export interface Solicitud {
  id: string;
  numeroSolicitud: string; // Autogenerado: SOL-001, SOL-002...
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  departamento: string; // Odontología, Laboratorio, etc.
  usuarioCreador: string; // Nombre (usuario) que la creó
  descripcion: string;
  prioridad: "Baja" | "Media" | "Alta";
  estado: "Pendiente" | "Aprobada" | "Rechazada" | "En Proceso" | "Entregada" | "En proceso" | "Completada" | "En preparación" | "Parcialmente entregada" | "Cancelada";
  observaciones: string;
  periodo: string; // Periodo mensual, ej: "Julio 2026"
  timestamp: number;
  historialCambios: CambioEstado[];
  items?: SolicitudItem[];
  catalogId?: string;
}

export interface RegistroHistorial {
  id: string;
  tipo: "Creación" | "Cambio de Estado" | "Eliminación";
  solicitudId: string;
  numeroSolicitud: string;
  descripcionEvent: string;
  usuarioResponsable: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  timestamp: number;
  catalogId?: string;
}

export interface ColoresConfig {
  primary: string;
  sidebar: string;
  buttons: string;
  headers: string;
  cards: string;
  tables: string;
  elements: string;
}

export interface ConfiguracionDoc {
  id: string;
  colores?: ColoresConfig;
  periodoActual?: string;
}
