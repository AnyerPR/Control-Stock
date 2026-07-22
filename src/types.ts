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
  lote: string;
  cantidad: number;
  precio: number;
  tipoMovimiento: "Entrada" | "Salida" | "Ajuste";
  usuario: string; // Nombre (usuario)
  fecha: string; // ISO string
  timestamp: number;
  catalogId?: string;
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
}

export function getEnabledModules(user: Usuario | null | undefined): string[] {
  if (!user) return [];
  if (user.modulos && Array.isArray(user.modulos)) {
    return user.modulos;
  }
  if (user.rol === "Administrador") {
    return ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"];
  }
  return ["solicitudes", "historial"];
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
