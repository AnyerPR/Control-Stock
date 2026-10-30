import React, { useState, useEffect, useRef, useMemo } from "react";
import { doc, onSnapshot, getDocs, getDoc, writeBatch, updateDoc, setDoc, deleteDoc, runTransaction } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  db,
  auth,
  tenantCollection,
  tenantDoc,
  getActiveFarmaciaId,
  setActiveFarmaciaId,
  DEFAULT_FARMACIA_ID,
  provisionUserInFirebaseAuth
} from "./firebase";
import {
  Producto,
  Usuario,
  Lote,
  Movimiento,
  ColoresConfig,
  Departamento,
  ConceptoFactura,
  DEFAULT_CONCEPTOS_FACTURA,
  getEnabledModules,
  getUserAvailableCatalogos,
  isModuleAuthorized,
  resolveModuleFromSlug,
  matchesCatalog
} from "./types";
import { playSound, setMuteState } from "./utils/audio";
import { hashPassword } from "./components/Login";

// Componentes modulares
import MarqueeText from "./components/MarqueeText";
import CargaMasiva from "./components/CargaMasiva";
import HistorialMovimientos from "./components/HistorialMovimientos";
import BlockPanel from "./components/BlockPanel";
import OrderPanel from "./components/OrderPanel";
import UserPanel from "./components/UserPanel";
import Login from "./components/Login";
import SolicitudesPanel from "./components/SolicitudesPanel";
import ConfiguracionPanel from "./components/ConfiguracionPanel";
import VentaPanel from "./components/VentaPanel";
import DashboardPanel from "./components/DashboardPanel";
import ChatLateral from "./components/ChatLateral";
import ProductPhotosEditor from "./components/ProductPhotosEditor";
import ImageLightbox from "./components/ImageLightbox";
import { PWAInstallButton, OfflineIndicator, APP_ICON_PATH } from "./components/PWAInstallButton";
import { logSystemEvent } from "./utils/chatHelper";
import { exportToWord, exportToPDF } from "./utils/exportUtils";
import { createAdjustedLot, getProductImages } from "./utils/productPhotos";
import { isLotExpiredWithStock } from "./utils/inventoryStatus";

// Suministros predefinidos para autosembrado (si la base de datos está vacía)
import { bH as DEFAULT_PRODUCTS } from "./defaultProducts";

// Iconos de Lucide
import {
  Layers,
  LayoutDashboard,
  ShoppingCart,
  Trash2,
  RefreshCw,
  Search,
  Plus,
  X,
  FileDown,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  LogOut,
  MapPin,
  PackageSearch,
  Package,
  PlusCircle,
  TrendingDown,
  TriangleAlert,
  Upload,
  UserPlus,
  User,
  Users,
  CheckCircle2,
  Settings,
  Shield,
  Volume2,
  VolumeX,
  LoaderCircle,
  ClipboardList,
  Clock,
  AlertCircle,
  Receipt
} from "lucide-react";

// Filtros del catálogo
const FILTROS_CATALOGO: Record<string, string> = {
  todos: "Todos",
  prioridad: "Prioridad Vence",
  bajo: "Stock bajo",
  proximo: "Por vencer",
  vencido: "Vencidos",
  fisico: "Diferencias físicas",
  sinStock: "Sin Stock",
  verificado: "Verificados",
  sinVerificar: "Sin verificar",
  ajustado: "Ajustados"
};

const BLOQUES = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

export default function App() {
  const [products, setProducts] = useState<Producto[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [users, setUsers] = useState<Usuario[]>([]);
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [catalogos, setCatalogos] = useState<any[]>([]);
  const [conceptos, setConceptos] = useState<ConceptoFactura[]>(DEFAULT_CONCEPTOS_FACTURA);
  const [activeCatalogId, setActiveCatalogId] = useState<string>("default-cat");
  const [currentUser, setCurrentUser] = useState<Usuario | null>(() => {
    const saved = localStorage.getItem("current_user");
    if (saved) {
      try { return JSON.parse(saved); } catch { return null; }
    }
    return null;
  });
  const [activeFarmaciaId, setActiveFarmaciaIdState] = useState<string>(() => getActiveFarmaciaId());
  const [farmaciaMeta, setFarmaciaMeta] = useState<{ nombre: string; subtitulo: string }>(() => {
    const saved = localStorage.getItem("active_farmacia_meta");
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return {
      nombre: "Control de Stock",
      subtitulo: "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
    };
  });
  const [authReady, setAuthReady] = useState(false);
  const [isFirebaseAuthed, setIsFirebaseAuthed] = useState(false);

  const [activeTab, setActiveTab] = useState<string>("inventory");
  const [catalogFilter, setCatalogFilter] = useState("todos");
  const [searchQuery, setSearchTerm] = useState("");
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);

  // Edit / Details Modal State
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLotes, setEditLotes] = useState<Lote[]>([]);
  const [editImages, setEditImages] = useState<string[]>([]);
  const [zoomProductImage, setZoomProductImage] = useState<{ url: string; alt: string } | null>(null);
  const [adjustingLotIds, setAdjustingLotIds] = useState<string[]>([]);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const [pendingDetailPhoto, setPendingDetailPhoto] = useState<string | null>(null);
  const [coincidenLotesMap, setCoincidenLotesMap] = useState<Record<string, boolean>>({});

  // Order / Pedido State
  const [showOrder, setShowOrder] = useState(false);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [orderSelectedProduct, setOrderSelectedProduct] = useState<string | null>(null);
  const [orderSelectedLot, setOrderSelectedLot] = useState<string | null>(null);
  const [orderSelectedQuantity, setOrderSelectedQuantity] = useState<number | null>(null);
  const [orderProductSearch, setOrderProductSearch] = useState("");
  const [orderCatalogId, setOrderCatalogId] = useState<string>("");

  // Blocks State
  const [showBlocks, setShowBlocks] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [blockLevelFilter, setBlockLevelFilter] = useState("todos");
  const [blockAddMode, setBlockAddMode] = useState<"selectProduct" | "selectLevel" | null>(null);
  const [blockAddProduct, setBlockAddProduct] = useState<string | null>(null);
  const [blockProductSearch, setBlockProductSearch] = useState("");

  // Lot Create Form inside Details
  const [showLotAdd, setShowLotAdd] = useState(false);
  const [newLotNum, setNewLotNum] = useState("");
  const [newLotQty, setNewLotQty] = useState("");
  const [newLotQtyF, setNewLotQtyF] = useState("");
  const [newLotLocation, setNewLotLocation] = useState("");
  const [newLotExpDate, setNewLotExpDate] = useState("");
  const [newLotPhysExpDate, setNewLotPhysExpDate] = useState("");
  const [newLotPrice, setNewLotPrice] = useState("");

  // Product / Invoice Entry Form (Imagen 3: Registro de Entrada de Productos)
  const [showProductAdd, setShowProductAdd] = useState(false);
  const [invoiceNum, setInvoiceNum] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoiceSupplier, setInvoiceSupplier] = useState("");
  const [pendingEntryItems, setPendingEntryItems] = useState<
    Array<{
      tempId: string;
      codigo: string;
      nombre: string;
      descripcion: string;
      numeroLote: string;
      loteFisico: string;
      cantidad: number;
      cantidadF: number;
      precio: number;
      fechaVencimiento: string;
      fechaFisica: string;
      imagen?: string;
      imagenes?: string[];
    }>
  >([]);
  const [confirmingEntry, setConfirmingEntry] = useState(false);

  const [newProdCode, setNewProdCode] = useState("");
  const [newProdName, setNewProdName] = useState("");
  const [newProdDesc, setNewProdDesc] = useState("");
  const [newProdLotNum, setNewProdLotNum] = useState("");
  const [newProdLotQty, setNewProdLotQty] = useState("");
  const [newProdLotQtyF, setNewProdLotQtyF] = useState("");
  const [newProdLotLocation, setNewProdLotLocation] = useState("");
  const [newProdLotExpDate, setNewProdLotExpDate] = useState("");
  const [newProdLotPhysExpDate, setNewProdLotPhysExpDate] = useState("");
  const [newProdLotPrice, setNewProdLotPrice] = useState("");
  const [newProdPhotos, setNewProdPhotos] = useState<string[]>([]);
  const [newProdPhotoProductCode, setNewProdPhotoProductCode] = useState<string | null>(null);
  const [newProdPhoto, setNewProdPhoto] = useState("");
  const [pendingNewProdPhoto, setPendingNewProdPhoto] = useState<string | null>(null);

  // Global Config (Cierre de mes & Colores)
  const [activePeriod, setActivePeriod] = useState<string>("Julio 2026");
  const [colores, setColores] = useState<ColoresConfig>({
    primary: "#0d9488", // Teal 600
    sidebar: "#115e59", // Teal 800
    buttons: "#0f766e", // Teal 700
    headers: "#115e59", // Teal 800
    cards: "#ffffff",
    tables: "#f8fafc",
    elements: "#0d9488"
  });

  const [loading, setLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const nameSuggestionsRef = useRef<HTMLDivElement>(null);

  // Click outside export menu / name suggestions to close them
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
      if (nameSuggestionsRef.current && !nameSuggestionsRef.current.contains(event.target as Node)) {
        setShowNameSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Safe module navigation helper that enforces user permissions and blocks unauthorized URL access
  const navigateToTab = (targetTab: string) => {
    if (!currentUser) return;
    if (targetTab === "dashboard") {
      setActiveTab("dashboard");
      setShowBlocks(false);
      setSelectedBlock(null);
      setShowOrder(false);
      return;
    }
    const enabled = getEnabledModules(currentUser);
    if (!enabled.includes(targetTab)) {
      playSound("negative");
      showToast("Acceso denegado: No tienes permisos para acceder a ese módulo.");
      const fallback = enabled[0] || "dashboard";
      setActiveTab(fallback);
      return;
    }
    setActiveTab(targetTab);
    setShowBlocks(false);
    setSelectedBlock(null);
  };

  // Auto-redirect to first enabled module (or verify URL route permissions) upon login or permission update
  useEffect(() => {
    if (!currentUser) return;
    const enabled = getEnabledModules(currentUser);

    const enforceRoutePermissions = () => {
      if (typeof window === "undefined") return false;
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get("tab") || urlParams.get("modulo") || urlParams.get("module");
      const hashSlug = window.location.hash ? window.location.hash.replace(/^#\/?/, "") : "";
      const pathSlug = window.location.pathname && window.location.pathname !== "/" ? window.location.pathname : "";

      const candidateSlug = tabParam || hashSlug || pathSlug;
      if (candidateSlug) {
        const resolvedMod = resolveModuleFromSlug(candidateSlug);
        if (resolvedMod) {
          if (resolvedMod === "dashboard") {
            setActiveTab("dashboard");
            return true;
          }
          if (enabled.includes(resolvedMod)) {
            setActiveTab(resolvedMod);
            return true;
          } else {
            // Block unauthorized direct URL access and clean URL
            try {
              window.history.replaceState(null, "", window.location.pathname.startsWith("/") ? "/" : window.location.pathname);
            } catch {}
            setToastMessage("Acceso restringido: No tienes autorización para abrir ese módulo.");
            const fallback = enabled[0] || "dashboard";
            setActiveTab(fallback);
            return true;
          }
        }
      }
      return false;
    };

    const handledByUrl = enforceRoutePermissions();
    if (!handledByUrl) {
      if (activeTab !== "dashboard" && !enabled.includes(activeTab)) {
        setActiveTab(enabled[0] || "dashboard");
      }
    }

    const onUrlChange = () => {
      enforceRoutePermissions();
    };
    window.addEventListener("hashchange", onUrlChange);
    window.addEventListener("popstate", onUrlChange);
    return () => {
      window.removeEventListener("hashchange", onUrlChange);
      window.removeEventListener("popstate", onUrlChange);
    };
  }, [currentUser, activeTab]);

  // Keep currentUser state in sync with users list from DB (including modulos and catalogos)
  useEffect(() => {
    if (currentUser && users.length > 0) {
      const dbUser = users.find(
        (u) =>
          u.id === currentUser.id &&
          (u.farmaciaId || DEFAULT_FARMACIA_ID) === (currentUser.farmaciaId || activeFarmaciaId)
      );
      if (dbUser) {
        const dbModulos = dbUser.modulos || [];
        const currentModulos = currentUser.modulos || [];
        const modulosChanged = JSON.stringify(dbModulos) !== JSON.stringify(currentModulos);

        const dbCatalogos = dbUser.catalogos || [];
        const currentCatalogos = currentUser.catalogos || [];
        const catalogosChanged = JSON.stringify(dbCatalogos) !== JSON.stringify(currentCatalogos);

        if (
          dbUser.nombre !== currentUser.nombre ||
          dbUser.rol !== currentUser.rol ||
          dbUser.estado !== currentUser.estado ||
          dbUser.departamento !== currentUser.departamento ||
          modulosChanged ||
          catalogosChanged
        ) {
          setCurrentUser(dbUser);
          localStorage.setItem("current_user", JSON.stringify(dbUser));
        }
      }
    }
  }, [users, currentUser, activeFarmaciaId]);

  // Listen to Firebase Auth session state
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode) {
      setAuthReady(true);
      setIsFirebaseAuthed(true);
      return;
    }

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        setIsFirebaseAuthed(true);
      } else {
        setIsFirebaseAuthed(false);
        // Clear any stale local session that isn't backed by Firebase Auth
        setCurrentUser(null);
        localStorage.removeItem("current_user");
        setLoading(false);
      }
      setAuthReady(true);
    });

    return () => unsubAuth();
  }, []);

  // Catalog Auto-Migration (only after authenticated in principal tenant)
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode || !authReady || !isFirebaseAuthed || !currentUser) return;

    const runCatalogMigration = async () => {
      const localMigrationKey = `migracion_catalogos_v2_done_${activeFarmaciaId}`;
      if (localStorage.getItem(localMigrationKey) === "1") return;
      try {
        const migrationRef = tenantDoc("configuracion", "migracion_catalogos_v2", activeFarmaciaId);
        const migrationSnap = await getDoc(migrationRef);
        
        // If already run, cache locally and do nothing
        if (migrationSnap.exists() && migrationSnap.data()?.completada) {
          localStorage.setItem(localMigrationKey, "1");
          return;
        }

        // 1. Ensure the default catalog "Medicamentos e Insumos" exists and has ID "default-cat"
        const defaultCatRef = tenantDoc("catalogos", "default-cat", activeFarmaciaId);
        await setDoc(defaultCatRef, {
          id: "default-cat",
          nombre: "Medicamentos e Insumos",
          descripcion: "Catálogo de Medicamentos e Insumos",
          activo: true,
          createdAt: Date.now()
        }, { merge: true });

        if (activeFarmaciaId === DEFAULT_FARMACIA_ID) {
          // Ensure "laboratorio" exists in principal hospital
          const labRef = tenantDoc("catalogos", "laboratorio", activeFarmaciaId);
          await setDoc(labRef, {
            id: "laboratorio",
            nombre: "Laboratorio",
            descripcion: "Catálogo de Laboratorio",
            activo: true,
            createdAt: Date.now()
          }, { merge: true });

          // Ensure "odontologia" exists in principal hospital
          const odRef = tenantDoc("catalogos", "odontologia", activeFarmaciaId);
          await setDoc(odRef, {
            id: "odontologia",
            nombre: "Odontología",
            descripcion: "Catálogo de Odontología",
            activo: true,
            createdAt: Date.now()
          }, { merge: true });
        }

        // Helper to update collection documents that are missing catalogId
        const migrateCollection = async (collectionName: string) => {
          const colRef = tenantCollection(collectionName, activeFarmaciaId);
          const snapshot = await getDocs(colRef);
          
          let batch = writeBatch(db);
          let batchCount = 0;

          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            if (!data.catalogId) {
              const docRef = tenantDoc(collectionName, docSnap.id, activeFarmaciaId);
              batch.update(docRef, { catalogId: "default-cat" });
              batchCount++;

              if (batchCount === 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
              }
            }
          }

          if (batchCount > 0) {
            await batch.commit();
          }
        };

        await migrateCollection("productos");
        await migrateCollection("movimientos");
        await migrateCollection("solicitudes");
        await migrateCollection("historial");

        await setDoc(migrationRef, {
          completada: true,
          timestamp: Date.now(),
          migratedCollections: ["productos", "movimientos", "solicitudes", "historial"]
        });
        localStorage.setItem(localMigrationKey, "1");
      } catch (err) {
        console.error("Error running catalog migration:", err);
      }
    };

    runCatalogMigration();
  }, [authReady, isFirebaseAuthed, currentUser, activeFarmaciaId]);

  // Real-time synchronization
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    
    if (isLocalFileMode) {
      console.log("Running in offline local file mode (file://). Bypassing Firebase.");
      setLoading(true);
      
      // 1. Configuración de colores por defecto
      const storedColores = localStorage.getItem("offline_colores");
      if (storedColores) {
        try { setColores(JSON.parse(storedColores)); } catch(e) {}
      } else {
        const defaultColores: ColoresConfig = {
          primary: "#0d9488",
          sidebar: "#134e4a",
          buttons: "#0d9488",
          headers: "#0f766e",
          cards: "#ffffff",
          tables: "#f8fafc",
          elements: "#14b8a6"
        };
        setColores(defaultColores);
        localStorage.setItem("offline_colores", JSON.stringify(defaultColores));
      }

      const storedPeriod = localStorage.getItem("offline_periodoActual");
      if (storedPeriod) {
        setActivePeriod(storedPeriod);
      } else {
        const currentYear = new Date().getFullYear().toString();
        setActivePeriod(currentYear);
        localStorage.setItem("offline_periodoActual", currentYear);
      }
      
      // 2. Cargar productos semilla (DEFAULT_PRODUCTS)
      const storedProducts = localStorage.getItem("offline_productos");
      if (storedProducts) {
        try { setProducts(JSON.parse(storedProducts)); } catch(e) {}
      } else {
        setProducts(DEFAULT_PRODUCTS);
        localStorage.setItem("offline_productos", JSON.stringify(DEFAULT_PRODUCTS));
      }
      
      // 3. Cargar bloques
      const storedBlocks = localStorage.getItem("offline_bloques");
      if (storedBlocks) {
        try { setBlocks(JSON.parse(storedBlocks)); } catch(e) {}
      } else {
        const initBlocks = BLOQUES.map((id) => ({ id, items: [], updatedAt: Date.now() }));
        setBlocks(initBlocks);
        localStorage.setItem("offline_bloques", JSON.stringify(initBlocks));
      }
      
      // 4. Inicializar usuarios locales ( Anyer, Francisco, Ivelyn )
      const storedUsers = localStorage.getItem("offline_usuarios");
      if (storedUsers) {
        try { setUsers(JSON.parse(storedUsers)); } catch(e) {}
      } else {
        const initLocalUsers = async () => {
          const defaultUsers = [
            { nombre: "Anyer", usuario: "Anyer", pass: "303005", rol: "Administrador" as const },
            { nombre: "Francisco", usuario: "Francisco", pass: "14147", rol: "Administrador" as const },
            { nombre: "Ivelyn", usuario: "Ivelyn", pass: "6606", rol: "Administrador" as const }
          ];
          const loadedUsers = [];
          for (const def of defaultUsers) {
            const hash = await hashPassword(def.pass);
            loadedUsers.push({
              id: `user-${def.usuario.toLowerCase()}`,
              nombre: def.nombre,
              usuario: def.usuario,
              contrasenaHash: hash,
              rol: def.rol,
              estado: "Activo" as const,
              updatedAt: Date.now(),
              departamento: "Almacén y Suministro"
            });
          }
          setUsers(loadedUsers);
          localStorage.setItem("offline_usuarios", JSON.stringify(loadedUsers));
        };
        initLocalUsers();
      }

      // 5. Cargar departamentos por defecto
      const storedDepts = localStorage.getItem("offline_departamentos");
      if (storedDepts) {
        try { setDepartamentos(JSON.parse(storedDepts)); } catch(e) {}
      } else {
        const defaultDepts = [
          "Almacén y Suministro",
          "Odontología",
          "Laboratorio",
          "Quirófano",
          "Urgencias",
          "Pediatría",
          "Gineco-Obstetricia",
          "Cirugía General",
          "Consulta Externa",
          "Farmacia Clínica"
        ];
        const initialDepts = defaultDepts.map(name => ({
          id: `dept-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
          nombre: name,
          activo: true,
          createdAt: Date.now()
        }));
        setDepartamentos(initialDepts);
        localStorage.setItem("offline_departamentos", JSON.stringify(initialDepts));
      }

      // 6. Cargar catálogo por defecto
      const storedCatalogos = localStorage.getItem("offline_catalogos");
      if (storedCatalogos) {
        try { 
          const cats = JSON.parse(storedCatalogos);
          setCatalogos(cats);
        } catch(e) {}
      } else {
        const defaultCatalogos = [
          { id: "default-cat", nombre: "Medicamentos e Insumos", activo: true, createdAt: Date.now() }
        ];
        setCatalogos(defaultCatalogos);
        localStorage.setItem("offline_catalogos", JSON.stringify(defaultCatalogos));
      }
      setActiveCatalogId("default-cat");

      const handleOfflineProductsUpdate = () => {
        const stored = localStorage.getItem("offline_productos");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setProducts(parsed);
          } catch (e) {}
        }
      };

      const handleOfflineDeptsUpdate = () => {
        const stored = localStorage.getItem("offline_departamentos");
        if (stored) {
          try { setDepartamentos(JSON.parse(stored)); } catch (e) {}
        }
      };

      const handleOfflineCatsUpdate = () => {
        const stored = localStorage.getItem("offline_catalogos");
        if (stored) {
          try { setCatalogos(JSON.parse(stored)); } catch (e) {}
        }
      };

      const storedConceptos = localStorage.getItem("offline_conceptos_venta");
      if (storedConceptos) {
        try {
          const parsed = JSON.parse(storedConceptos);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setConceptos(parsed);
          }
        } catch (e) {}
      } else {
        setConceptos(DEFAULT_CONCEPTOS_FACTURA);
        localStorage.setItem("offline_conceptos_venta", JSON.stringify(DEFAULT_CONCEPTOS_FACTURA));
      }

      const handleOfflineConceptosUpdate = () => {
        const stored = localStorage.getItem("offline_conceptos_venta");
        if (stored) {
          try { setConceptos(JSON.parse(stored)); } catch (e) {}
        }
      };

      window.addEventListener("offline_productos_update", handleOfflineProductsUpdate);
      window.addEventListener("offline_departamentos_update", handleOfflineDeptsUpdate);
      window.addEventListener("offline_catalogos_update", handleOfflineCatsUpdate);
      window.addEventListener("offline_conceptos_update", handleOfflineConceptosUpdate);

      setLoading(false);
      return () => {
        window.removeEventListener("offline_productos_update", handleOfflineProductsUpdate);
        window.removeEventListener("offline_departamentos_update", handleOfflineDeptsUpdate);
        window.removeEventListener("offline_catalogos_update", handleOfflineCatsUpdate);
        window.removeEventListener("offline_conceptos_update", handleOfflineConceptosUpdate);
      };
    }

    if (!authReady) {
      setLoading(true);
      return;
    }

    // Only subscribe to Firestore collections after Firebase Authentication is active
    if (!isFirebaseAuthed || !currentUser) {
      setLoading(false);
      return;
    }

    setLoading(true);

    // 1. Sync configuration (Colores & Periodo)
    const unsubColores = onSnapshot(
      tenantDoc("configuracion", "colores", activeFarmaciaId),
      (docSnap) => {
        if (docSnap.exists() && docSnap.data().colores) {
          setColores(docSnap.data().colores);
        }
      },
      (err) => console.error("Error listening to colores:", err)
    );

    const unsubPeriodo = onSnapshot(
      tenantDoc("configuracion", "periodo", activeFarmaciaId),
      (docSnap) => {
        if (docSnap.exists() && docSnap.data().periodoActual) {
          setActivePeriod(docSnap.data().periodoActual);
        }
      },
      (err) => console.error("Error listening to periodo:", err)
    );

    const unsubInstitucion = onSnapshot(
      tenantDoc("configuracion", "institucion", activeFarmaciaId),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          localStorage.setItem("active_institucion_info", JSON.stringify(data));
          if (data.nombre) {
            const nextMeta = {
              nombre: "Control de Stock",
              subtitulo: data.nombre
            };
            setFarmaciaMeta(nextMeta);
            localStorage.setItem("active_farmacia_meta", JSON.stringify(nextMeta));
          }
        }
      },
      (err) => console.error("Error listening to institucion:", err)
    );

    // 2. Sync Products
    const unsubProducts = onSnapshot(
      tenantCollection("productos", activeFarmaciaId),
      async (snapshot) => {
        if (snapshot.empty) {
          // Only seed DEFAULT_PRODUCTS for the original principal hospital
          if (activeFarmaciaId === DEFAULT_FARMACIA_ID) {
            try {
              const batch = writeBatch(db);
              const colRef = tenantCollection("productos", activeFarmaciaId);
              DEFAULT_PRODUCTS.forEach((p) => {
                const docRef = doc(colRef, p.codigo.replace(/\//g, "_"));
                batch.set(docRef, { ...p, updatedAt: Date.now() });
              });
              await batch.commit();
            } catch (err) {
              console.error("Error seeding products database:", err);
              setLoading(false);
            }
          } else {
            setProducts([]);
            setLoading(false);
          }
        } else {
          const list: Producto[] = [];
          snapshot.forEach((d) => {
            list.push(d.data() as Producto);
          });
          setProducts(list);
          setLoading(false);
        }
      },
      (err) => {
        console.error("Error listening to productos:", err);
        setLoading(false);
      }
    );

    const userMods = getEnabledModules(currentUser);

    // 3. Sync Blocks (only if user has inventory module enabled to avoid unnecessary listeners)
    const unsubBlocks = userMods.includes("inventory")
      ? onSnapshot(
          tenantCollection("bloques", activeFarmaciaId),
          async (snapshot) => {
            const dbBlocks: Record<string, any> = {};
            snapshot.forEach((d) => {
              dbBlocks[d.id] = d.data();
            });

            const fullBlocks = BLOQUES.map((id) => ({
              id,
              items: dbBlocks[id]?.items || [],
              updatedAt: dbBlocks[id]?.updatedAt || Date.now()
            }));

            // Seed missing blocks to Firestore
            const missing = BLOQUES.filter((id) => !dbBlocks[id]);
            if (missing.length > 0) {
              try {
                const batch = writeBatch(db);
                const colRef = tenantCollection("bloques", activeFarmaciaId);
                missing.forEach((id) => {
                  batch.set(doc(colRef, id), { id, items: [], updatedAt: Date.now() });
                });
                await batch.commit();
              } catch (err) {
                console.error("Error seeding empty blocks:", err);
              }
            }
            setBlocks(fullBlocks);
          },
          (err) => console.error("Error listening to bloques:", err)
        )
      : () => {};

    // 4. Sync Users & background Firebase Auth provisioning
    const unsubUsers = onSnapshot(
      tenantCollection("usuarios", activeFarmaciaId),
      async (snapshot) => {
        const list: Usuario[] = [];
        const batchUpdates: Promise<void>[] = [];

        snapshot.forEach((d) => {
          const u = d.data() as Usuario;
          if (!u.departamento) {
            u.departamento = "Almacén y Suministro";
            batchUpdates.push(
              setDoc(tenantDoc("usuarios", d.id, activeFarmaciaId), { departamento: "Almacén y Suministro" }, { merge: true })
            );
          }
          list.push(u);
        });

        if (batchUpdates.length > 0) {
          Promise.all(batchUpdates).catch((err) => console.error("Error updating existing users department:", err));
        }

        // Auto-create default users ONLY in the principal hospital
        if (activeFarmaciaId === DEFAULT_FARMACIA_ID) {
          const defaultUsers = [
            { nombre: "Anyer", usuario: "Anyer", pass: "303005", rol: "Administrador" as const },
            { nombre: "Francisco", usuario: "Francisco", pass: "14147", rol: "Administrador" as const },
            { nombre: "Ivelyn", usuario: "Ivelyn", pass: "6606", rol: "Administrador" as const }
          ];

          for (const def of defaultUsers) {
            if (!list.some((u) => u.usuario.toLowerCase() === def.usuario.toLowerCase())) {
              try {
                const hash = await hashPassword(def.pass);
                const newUser: Usuario = {
                  id: `user-${def.usuario.toLowerCase()}`,
                  nombre: def.nombre,
                  usuario: def.usuario,
                  contrasenaHash: hash,
                  rol: def.rol,
                  estado: "Activo",
                  updatedAt: Date.now(),
                  departamento: "Almacén y Suministro",
                  farmaciaId: activeFarmaciaId
                };
                await setDoc(tenantDoc("usuarios", newUser.id, activeFarmaciaId), newUser);
                list.push(newUser);
              } catch (err) {
                console.error("Error seeding default users:", err);
              }
            }
          }
        }

        // Ensure all active users in this pharmacy are provisioned in Firebase Auth in the background
        list.forEach((u) => {
          if (u.usuario && u.contrasenaHash && u.estado === "Activo") {
            provisionUserInFirebaseAuth(u.usuario, u.contrasenaHash, activeFarmaciaId).catch(() => {});
          }
        });

        setUsers(list);
      },
      (err) => console.error("Error listening to usuarios:", err)
    );

    // 5. Sync Departments
    const unsubDepts = onSnapshot(
      tenantCollection("departamentos", activeFarmaciaId),
      async (snapshot) => {
        if (snapshot.empty) {
          try {
            const batch = writeBatch(db);
            const colRef = tenantCollection("departamentos", activeFarmaciaId);
            const defaultDepts =
              activeFarmaciaId === DEFAULT_FARMACIA_ID
                ? [
                    "Almacén y Suministro",
                    "Odontología",
                    "Laboratorio",
                    "Quirófano",
                    "Urgencias",
                    "Pediatría",
                    "Gineco-Obstetricia",
                    "Cirugía General",
                    "Consulta Externa",
                    "Farmacia Clínica"
                  ]
                : [
                    "Almacén y Suministro",
                    "Despacho / Mostrador",
                    "Farmacia Clínica",
                    "Administración"
                  ];
            defaultDepts.forEach((name) => {
              const id = `dept-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
              batch.set(doc(colRef, id), {
                id,
                nombre: name,
                activo: true,
                createdAt: Date.now()
              });
            });
            await batch.commit();
          } catch (err) {
            console.error("Error seeding departments:", err);
          }
        } else {
          const list: Departamento[] = [];
          snapshot.forEach((d) => list.push(d.data() as Departamento));
          list.sort((a, b) => a.nombre.localeCompare(b.nombre));
          setDepartamentos(list);
        }
      },
      (err) => console.error("Error listening to departamentos:", err)
    );

    // 6. Sync Catalogos
    const unsubCatalogos = onSnapshot(
      tenantCollection("catalogos", activeFarmaciaId),
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });
        list.sort((a, b) => {
          const activeA = a.activo ? 1 : 0;
          const activeB = b.activo ? 1 : 0;
          return activeB - activeA || a.nombre.localeCompare(b.nombre);
        });
        setCatalogos(list);

        if (list.length > 0) {
          const allowedForUser = getUserAvailableCatalogos(currentUser, list);
          const stored = localStorage.getItem("active_catalog_id");
          const storedAllowed = allowedForUser.find((c) => c.id === stored && c.activo !== false);
          if (storedAllowed) {
            setActiveCatalogId(storedAllowed.id);
          } else if (allowedForUser.length > 0) {
            setActiveCatalogId(allowedForUser[0].id);
            localStorage.setItem("active_catalog_id", allowedForUser[0].id);
          } else {
            const activeItem = list.find((c) => c.activo);
            const fallbackId = activeItem ? activeItem.id : list[0].id;
            setActiveCatalogId(fallbackId);
            localStorage.setItem("active_catalog_id", fallbackId);
          }
        } else {
          // Seed default catalogs if empty
          const defaultCatRef = tenantDoc("catalogos", "default-cat", activeFarmaciaId);
          setDoc(defaultCatRef, {
            id: "default-cat",
            nombre: "Medicamentos e Insumos",
            descripcion: "Catálogo por defecto del sistema de stock",
            activo: true,
            createdAt: Date.now()
          }).catch(err => console.error("Error seeding default catalog:", err));
        }
      },
      (err) => console.error("Error listening to catalogos:", err)
    );

    // 7. Sync Conceptos de Facturación (only when Venta or Configuracion is enabled for user)
    const unsubConceptos =
      userMods.includes("venta") || userMods.includes("configuracion")
        ? onSnapshot(
            tenantDoc("configuracion", "conceptos_venta", activeFarmaciaId),
            (docSnap) => {
              if (docSnap.exists() && Array.isArray(docSnap.data().items) && docSnap.data().items.length > 0) {
                setConceptos(docSnap.data().items);
              } else {
                setConceptos(DEFAULT_CONCEPTOS_FACTURA);
                setDoc(
                  tenantDoc("configuracion", "conceptos_venta", activeFarmaciaId),
                  { items: DEFAULT_CONCEPTOS_FACTURA, updatedAt: Date.now() },
                  { merge: true }
                ).catch(() => {});
              }
            },
            (err) => console.error("Error listening to conceptos_venta:", err)
          )
        : () => {};

    return () => {
      unsubColores();
      unsubPeriodo();
      unsubInstitucion();
      unsubProducts();
      unsubBlocks();
      unsubUsers();
      unsubDepts();
      unsubCatalogos();
      unsubConceptos();
    };
  }, [activePeriod, authReady, isFirebaseAuthed, currentUser?.id, activeFarmaciaId]);

  // Auto-saving observers for offline mode
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && products && products.length > 0) {
      const existing = localStorage.getItem("offline_productos");
      const serialized = JSON.stringify(products);
      if (existing !== serialized) {
        localStorage.setItem("offline_productos", serialized);
        window.dispatchEvent(new Event("offline_productos_update"));
      }
    }
  }, [products]);

  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && blocks && blocks.length > 0) {
      localStorage.setItem("offline_bloques", JSON.stringify(blocks));
    }
  }, [blocks]);

  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && users && users.length > 0) {
      localStorage.setItem("offline_usuarios", JSON.stringify(users));
    }
  }, [users]);

  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && departamentos && departamentos.length > 0) {
      localStorage.setItem("offline_departamentos", JSON.stringify(departamentos));
    }
  }, [departamentos]);

  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && catalogos && catalogos.length > 0) {
      localStorage.setItem("offline_catalogos", JSON.stringify(catalogos));
    }
  }, [catalogos]);

  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && colores) {
      localStorage.setItem("offline_colores", JSON.stringify(colores));
    }
  }, [colores]);

  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode && activePeriod) {
      localStorage.setItem("offline_periodoActual", activePeriod);
    }
  }, [activePeriod]);

  // Synchronize active catalog and order catalog when currentUser or catalogos changes
  useEffect(() => {
    if (currentUser && catalogos.length > 0) {
      const allowed = getAvailableCatalogos();
      const isAllowed = allowed.some((c) => c.id === activeCatalogId);
      const effectiveCatId = isAllowed ? activeCatalogId : (allowed[0]?.id || activeCatalogId);
      if (!isAllowed && allowed.length > 0) {
        setActiveCatalogId(allowed[0].id);
        localStorage.setItem("active_catalog_id", allowed[0].id);
      }
      if (!orderCatalogId && orderItems.length === 0 && effectiveCatId) {
        setOrderCatalogId(effectiveCatId);
      }
    }
  }, [currentUser, catalogos, activeCatalogId, orderCatalogId, orderItems.length]);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  const getDaysToExpiration = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr + "T00:00:00");
    return Math.ceil((expDate.getTime() - today.getTime()) / 86400000);
  };

  const getEarliestExpiration = (p: Producto) => {
    if (!p.lotes || p.lotes.length === 0) return Infinity;
    let earliest = Infinity;
    p.lotes.forEach((l) => {
      if (Number(l.cantidad || 0) <= 0 || !l.fechaVencimiento) return;
      const t = new Date(l.fechaVencimiento + "T00:00:00").getTime();
      if (!isNaN(t) && t < earliest) earliest = t;
    });
    return earliest;
  };

  // Precompute stats per product in a memoized Map for fast O(1) lookup during filtering and rendering
  const productStatsMap = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const map = new Map<string, {
      totalStock: number;
      physicalStock: number;
      hasExpired: boolean;
      hasSoonToExpire: boolean;
      hasNextToExpire: boolean;
      hasAdjusted: boolean;
      lowStock: boolean;
      noStockBoth: boolean;
      noStockSystem: boolean;
      noStockPhysical: boolean;
      wideMismatch: boolean;
      verificado: boolean;
      earliestExp: number;
    }>();

    for (const p of products) {
      let totalStock = 0;
      let physicalStock = 0;
      let hasExpired = false;
      let hasSoonToExpire = false;
      let hasNextToExpire = false;
      let hasAdjusted = false;
      let wideMismatch = false;
      let earliestExp = Infinity;

      for (const l of p.lotes) {
        const cSys = Number(l.cantidad || 0);
        const cFis = Number(l.cantidadF || 0);
        totalStock += cSys;
        physicalStock += cFis;
        if (cFis !== cSys) wideMismatch = true;
        if (l.articuloAjustado) hasAdjusted = true;
        if (l.fechaVencimiento) {
          const expMs = new Date(l.fechaVencimiento + "T00:00:00").getTime();
          if (!isNaN(expMs)) {
            if (Number(l.cantidad || 0) > 0 && expMs < earliestExp) earliestExp = expMs;
            const days = Math.ceil((expMs - todayMs) / 86400000);
            if (days < 0) {
              if (isLotExpiredWithStock(l, today)) hasExpired = true;
            } else if (cSys > 0 && days <= 30) hasSoonToExpire = true;
            else if (cSys > 0 && days <= 90) hasNextToExpire = true;
          }
        }
      }

      map.set(p.codigo, {
        totalStock,
        physicalStock,
        hasExpired,
        hasSoonToExpire,
        hasNextToExpire,
        hasAdjusted,
        lowStock: totalStock < 20,
        noStockBoth: totalStock === 0 && physicalStock === 0,
        noStockSystem: totalStock === 0,
        noStockPhysical: physicalStock === 0,
        wideMismatch,
        verificado: !!p.verificado,
        earliestExp
      });
    }
    return map;
  }, [products]);

  // Get details and lots status for a product (uses memoized Map when available)
  const getProductStats = (p: Producto) => {
    const cached = productStatsMap.get(p.codigo);
    if (cached) return cached;

    const totalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidad || 0), 0);
    const physicalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidadF || 0), 0);
    const hasExpired = p.lotes.some((l) => isLotExpiredWithStock(l));
    const hasSoonToExpire = p.lotes.some((l) => {
      if (Number(l.cantidad || 0) <= 0) return false;
      const days = getDaysToExpiration(l.fechaVencimiento);
      return days >= 0 && days <= 30;
    });
    const hasNextToExpire = p.lotes.some((l) => {
      if (Number(l.cantidad || 0) <= 0) return false;
      const days = getDaysToExpiration(l.fechaVencimiento);
      return days > 30 && days <= 90;
    });

    return {
      totalStock,
      physicalStock,
      hasExpired,
      hasSoonToExpire,
      hasNextToExpire,
      hasAdjusted: p.lotes.some((l) => !!l.articuloAjustado),
      lowStock: totalStock < 20,
      noStockBoth: totalStock === 0 && physicalStock === 0,
      noStockSystem: totalStock === 0,
      noStockPhysical: physicalStock === 0,
      wideMismatch: p.lotes.some((l) => Number(l.cantidadF || 0) !== Number(l.cantidad || 0)),
      verificado: !!p.verificado
    };
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      setMuteState(next);
      return next;
    });
  };

  const availableCatalogosMemo = useMemo(() => {
    return getUserAvailableCatalogos(currentUser, catalogos);
  }, [catalogos, currentUser]);

  const getAvailableCatalogos = () => availableCatalogosMemo;

  // Memoized Filter & Search Logic
  const filteredProductsMemo = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    
    let filtered = products.filter((p) => {
      if (!matchesCatalog(p.catalogId, activeCatalogId, catalogos)) return false;

      if (search) {
        const matchesMain =
          p.nombre.toLowerCase().includes(search) ||
          (p.descripcion || "").toLowerCase().includes(search) ||
          p.codigo.toLowerCase().includes(search);

        const matchesLotes = p.lotes.some(
          (l) =>
            l.numeroLote.toLowerCase().includes(search) ||
            (l.loteFisico || "").toLowerCase().includes(search)
        );

        if (!matchesMain && !matchesLotes) return false;
      }

      if (showUnverifiedOnly && p.verificado) {
        return false;
      }

      if (catalogFilter === "todos") return true;

      const stats = productStatsMap.get(p.codigo) || getProductStats(p);
      switch (catalogFilter) {
        case "bajo":
          return stats.lowStock;
        case "proximo":
          return stats.hasSoonToExpire;
        case "vencido":
          return stats.hasExpired;
        case "fisico":
          return stats.wideMismatch;
        case "sinStock":
          return stats.noStockBoth;
        case "verificado":
          return stats.verificado;
        case "sinVerificar":
          return !stats.verificado;
        case "ajustado":
          return stats.hasAdjusted;
        default:
          return true;
      }
    });

    if (catalogFilter === "prioridad") {
      filtered = [...filtered].sort((a, b) => {
        const timeA = productStatsMap.get(a.codigo)?.earliestExp ?? getEarliestExpiration(a);
        const timeB = productStatsMap.get(b.codigo)?.earliestExp ?? getEarliestExpiration(b);
        if (timeA === timeB) return a.nombre.localeCompare(b.nombre);
        return timeA - timeB;
      });
    } else {
      filtered = [...filtered].sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    return filtered;
  }, [products, activeCatalogId, searchQuery, showUnverifiedOnly, catalogFilter, productStatsMap]);

  const getFilteredProducts = () => filteredProductsMemo;

  // Product verifications
  const handleToggleVerification = async (e: React.MouseEvent, productCode: string) => {
    e.stopPropagation();
    const prod = products.find((p) => p.codigo === productCode);
    if (!prod) return;

    const allAdjusted = prod.lotes.length > 0 && prod.lotes.every((l) => !!l.articuloAjustado);
    if (allAdjusted && !prod.verificado) {
      showToast("No se puede verificar: todos los lotes de este producto están ajustados.");
      playSound("negative");
      return;
    }

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    try {
      const nextVerificado = !prod.verificado;
      const finalVerificado = allAdjusted ? false : nextVerificado;
      const updated = { ...prod, verificado: finalVerificado, updatedAt: Date.now() };
      if (isLocalFileMode) {
        setProducts(prev => prev.map(p => p.codigo === productCode ? updated : p));
      } else {
        await updateDoc(tenantDoc("productos", productCode.replace(/\//g, "_"), activeFarmaciaId), updated);
      }
      playSound(finalVerificado ? "positive" : "negative");
      showToast(finalVerificado ? "Marcado como verificado" : "Marca de verificado removida");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar estado de verificación");
    }
  };

  // General db save helper for products
  const saveProductDoc = async (prod: Producto) => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    const ref = tenantDoc("productos", prod.codigo.replace(/\//g, "_"), activeFarmaciaId);
    const allAdjusted = prod.lotes.length > 0 && prod.lotes.every((l) => !!l.articuloAjustado);
    const prodData: Producto = {
      ...prod,
      catalogId: prod.catalogId || activeCatalogId,
      verificado: allAdjusted ? false : (prod.verificado || false),
      updatedAt: Date.now()
    };

    if (isLocalFileMode) {
      const storedProducts = localStorage.getItem("offline_productos");
      const localProducts = storedProducts ? JSON.parse(storedProducts) as Producto[] : products;
      const exists = localProducts.some((product) => product.codigo === prod.codigo);
      const updatedProducts = exists
        ? localProducts.map((product) => product.codigo === prod.codigo ? prodData : product)
        : [...localProducts, prodData];
      localStorage.setItem("offline_productos", JSON.stringify(updatedProducts));
      window.dispatchEvent(new Event("offline_productos_update"));
    } else {
      await setDoc(ref, prodData);
    }

    setProducts((previous) => {
      const exists = previous.some((product) => product.codigo === prod.codigo);
      return exists
        ? previous.map((product) => product.codigo === prod.codigo ? prodData : product)
        : [...previous, prodData];
    });
  };

  // Log single inventory movement
  const saveMovementLog = async (mov: Omit<Movimiento, "id">) => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    try {
      const id = `mov-${mov.productoCodigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const movData = {
        id,
        catalogId: mov.catalogId || activeCatalogId,
        ...mov
      };
      if (isLocalFileMode) {
        let stored = localStorage.getItem("offline_movimientos");
        let list = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list.unshift(movData);
        localStorage.setItem("offline_movimientos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_movimientos_update"));

        logSystemEvent(`📦 **Movimiento de Inventario**: Se registró una **${mov.tipoMovimiento}** del producto **${mov.productoNombre}** (Lote: ${mov.lote}, Cantidad: ${mov.cantidad}) por el usuario ${mov.usuario}.`);
      } else {
        await setDoc(tenantDoc("movimientos", id, activeFarmaciaId), movData);
        logSystemEvent(`📦 **Movimiento de Inventario**: Se registró una **${mov.tipoMovimiento}** del producto **${mov.productoNombre}** (Lote: ${mov.lote}, Cantidad: ${mov.cantidad}) por el usuario ${mov.usuario}.`);
      }
    } catch (err) {
      console.error("Error creating movement log:", err);
    }
  };

  const productCoordinatesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of blocks) {
      for (const item of b.items || []) {
        if (item.productCode && !map.has(item.productCode)) {
          map.set(item.productCode, `Bloque ${b.id} • Nivel ${item.nivel}`);
        }
      }
    }
    return map;
  }, [blocks]);

  const getProductCoordinates = (productCode: string) => {
    return productCoordinatesMap.get(productCode) || "No asignado";
  };

  // Comprime y optimiza la imagen en el navegador (~15-25 KB) para almacenarla directamente en Firebase Firestore sin costo extra
  const compressImageForFirestore = (file: File, maxDimension = 420, quality = 0.78): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer el archivo de imagen."));
      reader.onload = () => {
        const result = reader.result as string;
        if (file.type === "image/svg+xml") {
          resolve(result);
          return;
        }
        const img = new Image();
        img.onerror = () => reject(new Error("Formato de imagen no válido."));
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(result);
            return;
          }
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          // Intentar WebP primero por su alta compresión; si no, JPEG
          let dataUrl = canvas.toDataURL("image/webp", quality);
          if (!dataUrl.startsWith("data:image/webp")) {
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }
          resolve(dataUrl);
        };
        img.src = result;
      };
      reader.readAsDataURL(file);
    });
  };

  const Ni = async (file: File) => {
    // Almacenar directamente optimizado para Firebase Firestore (100% independiente de servicios externos)
    return await compressImageForFirestore(file, 420, 0.78);
  };

  const handleAddUser = async (data: {
    nombre: string;
    usuario: string;
    passwordText: string;
    rol: "Administrador" | "Operador";
    estado: "Activo" | "Inactivo";
    departamento: string;
    modulos?: string[];
    catalogos?: string[];
  }) => {
    if (!isModuleAuthorized(currentUser, "usuarios")) {
      showToast("No tienes permisos para administrar usuarios.");
      return;
    }
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    try {
      const hash = await hashPassword(data.passwordText);
      const newUser: Usuario = {
        id: `user-${data.usuario.toLowerCase()}`,
        nombre: data.nombre,
        usuario: data.usuario,
        contrasenaHash: hash,
        rol: data.rol,
        estado: data.estado,
        updatedAt: Date.now(),
        departamento: data.departamento,
        farmaciaId: activeFarmaciaId,
        modulos: data.modulos || (data.rol === "Administrador" ? ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"] : ["solicitudes", "historial"]),
        catalogos: data.catalogos || []
      };
      if (isLocalFileMode) {
        setUsers(prev => [...prev, newUser]);
      } else {
        await provisionUserInFirebaseAuth(data.usuario, hash, activeFarmaciaId);
        await setDoc(tenantDoc("usuarios", newUser.id, activeFarmaciaId), newUser);
      }
      playSound("positive");
      showToast(`Usuario "${data.usuario}" registrado con éxito.`);
    } catch (err) {
      console.error(err);
      alert("Error al registrar el usuario.");
    }
  };

  const handleUpdateUser = async (id: string, data: Partial<Usuario>) => {
    if (!isModuleAuthorized(currentUser, "usuarios")) {
      showToast("No tienes permisos para modificar usuarios.");
      return;
    }
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    try {
      if (isLocalFileMode) {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, ...data, updatedAt: Date.now() } : u));
      } else {
        await updateDoc(tenantDoc("usuarios", id, activeFarmaciaId), { ...data, updatedAt: Date.now() });
      }
      playSound("positive");
      showToast("Usuario actualizado con éxito.");
    } catch (err) {
      console.error(err);
      alert("Error al actualizar el usuario.");
    }
  };

  const handleChangeUserPassword = async (id: string, passwordText: string) => {
    if (!isModuleAuthorized(currentUser, "usuarios")) {
      showToast("No tienes permisos para cambiar contraseñas.");
      return;
    }
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    try {
      const hash = await hashPassword(passwordText);
      if (isLocalFileMode) {
        setUsers(prev => prev.map(u => u.id === id ? { ...u, contrasenaHash: hash, updatedAt: Date.now() } : u));
      } else {
        const targetUser = users.find((u) => u.id === id);
        if (targetUser) {
          await provisionUserInFirebaseAuth(targetUser.usuario, hash, activeFarmaciaId);
        }
        await updateDoc(tenantDoc("usuarios", id, activeFarmaciaId), { contrasenaHash: hash, updatedAt: Date.now() });
      }
      playSound("positive");
      showToast("Contraseña actualizada con éxito.");
    } catch (err) {
      console.error(err);
      alert("Error al actualizar la contraseña.");
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!isModuleAuthorized(currentUser, "usuarios")) {
      showToast("No tienes permisos para eliminar usuarios.");
      return;
    }
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    try {
      if (isLocalFileMode) {
        setUsers(prev => prev.filter(u => u.id !== id));
      } else {
        await deleteDoc(tenantDoc("usuarios", id, activeFarmaciaId));
      }
      playSound("negative");
      showToast("Usuario eliminado del sistema.");
    } catch (err) {
      console.error(err);
      alert("Error al eliminar el usuario.");
    }
  };

  // Open Product Details / Edit Panel
  const handleOpenDetails = (code: string) => {
    const prod = products.find((p) => p.codigo === code);
    if (!prod) return;

    setSelectedProductCode(code);
    setEditName(prod.nombre);
    setEditDesc(prod.descripcion || "");
    setEditLotes(JSON.parse(JSON.stringify(prod.lotes))); // deep clone
    setEditImages(getProductImages(prod));

    // Initialize "coinciden" checkboxes based on whether system & physical lots match
    const matchMap: Record<string, boolean> = {};
    prod.lotes.forEach((l) => {
      matchMap[l.id] = Number(l.cantidadF || 0) === Number(l.cantidad || 0);
    });
    setCoincidenLotesMap(matchMap);
    setShowLotAdd(false);
    playSound("open");
  };

  // Delete product entirely
  const handleDeleteProduct = async () => {
    if (!selectedProductCode) return;
    const prod = products.find((p) => p.codigo === selectedProductCode);
    if (!prod) return;

    if (confirm(`¿Eliminar por completo "${prod.nombre}" y todos sus lotes registrados?`)) {
      try {
        const batch = writeBatch(db);
        batch.delete(tenantDoc("productos", selectedProductCode.replace(/\//g, "_"), activeFarmaciaId));
        await batch.commit();

        setSelectedProductCode(null);
        playSound("negative");
        showToast("Insumo eliminado por completo del catálogo");
      } catch (err) {
        console.error("Error deleting product:", err);
        showToast("Error al eliminar producto");
      }
    }
  };

  // Coincide state toggler
  const handleToggleCoincide = (lotId: string, checked: boolean) => {
    setCoincidenLotesMap((prev) => ({ ...prev, [lotId]: checked }));
    if (checked) {
      setEditLotes((prev) =>
        prev.map((l) =>
          l.id === lotId
            ? { ...l, cantidadF: l.cantidad, fechaFisica: l.fechaVencimiento, loteFisico: l.numeroLote }
            : l
        )
      );
    }
  };

  // Lot field editor inside Detail Modal
  const handleEditLotField = (lotId: string, field: keyof Lote, value: any) => {
    setEditLotes((prev) =>
      prev.map((l) => {
        if (l.id === lotId) {
          const updated = { ...l, [field]: value };
          if (coincidenLotesMap[lotId]) {
            if (field === "cantidad") updated.cantidadF = Number(value);
            else if (field === "fechaVencimiento") updated.fechaFisica = String(value);
            else if (field === "numeroLote") updated.loteFisico = String(value);
          }
          return updated;
        }
        return l;
      })
    );
  };

  const handleToggleAdjusted = async (lotId: string, checked: boolean) => {
    if (!selectedProductCode || !currentUser || !getEnabledModules(currentUser).includes("inventory")) {
      showToast("No tienes permisos para ajustar este inventario.");
      playSound("negative");
      return;
    }

    const sourceProduct = products.find((product) => product.codigo === selectedProductCode);
    const sourceLot = sourceProduct?.lotes.find((lot) => lot.id === lotId);
    const draftLot = editLotes.find((lot) => lot.id === lotId);
    if (!sourceProduct || !sourceLot || !draftLot) return;

    const normalizePhysicalValue = (value: string | number | undefined) => String(value ?? "").trim();
    if (checked && (
      normalizePhysicalValue(draftLot.cantidadF) !== normalizePhysicalValue(sourceLot.cantidadF) ||
      normalizePhysicalValue(draftLot.loteFisico) !== normalizePhysicalValue(sourceLot.loteFisico) ||
      normalizePhysicalValue(draftLot.fechaFisica) !== normalizePhysicalValue(sourceLot.fechaFisica)
    )) {
      showToast("Guarda primero los cambios de los datos físicos y luego aplica el ajuste.");
      playSound("negative");
      return;
    }
    if (checked) {
      try {
        createAdjustedLot(sourceLot, true);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Los datos físicos del lote no son válidos.");
        playSound("negative");
        return;
      }
    }
    if (adjustingLotIds.includes(lotId)) return;

    setAdjustingLotIds((previous) => [...previous, lotId]);
    try {
      const nowTs = Date.now();
      const nowIso = new Date(nowTs).toISOString();
      const movementId = `ajuste-${selectedProductCode.replace(/\//g, "_")}-${lotId.replace(/\//g, "_")}-${nowTs}`;
      const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
      let updatedProduct: Producto | null = null;
      let adjustmentMovement: Movimiento | null = null;

      if (isLocalFileMode) {
        const storedProducts = localStorage.getItem("offline_productos");
        if (!storedProducts) throw new Error("No se encontró el inventario local para guardar el ajuste.");
        const localProducts = JSON.parse(storedProducts) as Producto[];
        const localProduct = localProducts.find((product) => product.codigo === selectedProductCode);
        const localLot = localProduct?.lotes.find((lot) => lot.id === lotId);
        if (!localProduct || !localLot) throw new Error("El producto o lote ya no existe en el inventario local.");
        if (checked && localLot.articuloAjustado) {
          updatedProduct = localProduct;
        } else {
          const nextLot = createAdjustedLot(localLot, checked);
          const difference = Number(nextLot.cantidad) - Number(localLot.cantidad);
          const nextLots = localProduct.lotes.map((lot) => lot.id === lotId ? nextLot : lot);
          updatedProduct = {
            ...localProduct,
            lotes: nextLots,
            verificado: nextLots.every((lot) => !!lot.articuloAjustado) ? false : !!localProduct.verificado,
            updatedAt: nowTs
          };
          const storedMovements = localStorage.getItem("offline_movimientos");
          const movements = storedMovements ? JSON.parse(storedMovements) as Movimiento[] : [];
          if (checked && difference !== 0) {
            adjustmentMovement = {
              id: movementId,
              productoCodigo: localProduct.codigo,
              productoNombre: localProduct.nombre,
              lote: nextLot.numeroLote,
              cantidad: Math.abs(difference),
              precio: localLot.precio,
              tipoMovimiento: "Ajuste",
              usuario: `${currentUser.nombre} (${currentUser.usuario})`,
              fecha: nowIso,
              timestamp: nowTs,
              catalogId: localProduct.catalogId || activeCatalogId
            };
          }

          const originalMovements = storedMovements;
          try {
            localStorage.setItem("offline_productos", JSON.stringify(
              localProducts.map((product) => product.codigo === selectedProductCode ? updatedProduct : product)
            ));
            if (adjustmentMovement) {
              localStorage.setItem("offline_movimientos", JSON.stringify([adjustmentMovement, ...movements]));
            }
          } catch (error) {
            try {
              localStorage.setItem("offline_productos", storedProducts);
              if (originalMovements === null) localStorage.removeItem("offline_movimientos");
              else localStorage.setItem("offline_movimientos", originalMovements);
            } catch (rollbackError) {
              console.error("No se pudo revertir el ajuste local:", rollbackError);
            }
            throw error;
          }
          window.dispatchEvent(new Event("offline_productos_update"));
          if (adjustmentMovement) window.dispatchEvent(new Event("offline_movimientos_update"));
        }
      } else {
        const productRef = tenantDoc("productos", selectedProductCode.replace(/\//g, "_"), activeFarmaciaId);
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(productRef);
          if (!snapshot.exists()) throw new Error("El producto ya no existe en esta sede.");
          const serverProduct = snapshot.data() as Producto;
          const currentLot = serverProduct.lotes.find((lot) => lot.id === lotId);
          if (!currentLot) throw new Error("El lote ya no existe en esta sede.");

          if (checked && currentLot.articuloAjustado) {
            updatedProduct = serverProduct;
            return;
          }

          const nextLot = createAdjustedLot(currentLot, checked);
          const difference = Number(nextLot.cantidad) - Number(currentLot.cantidad);
          const nextLots = serverProduct.lotes.map((lot) => lot.id === lotId ? nextLot : lot);
          const nextProduct: Producto = {
            ...serverProduct,
            lotes: nextLots,
            verificado: nextLots.every((lot) => !!lot.articuloAjustado) ? false : !!serverProduct.verificado,
            updatedAt: nowTs
          };

          transaction.update(productRef, {
            lotes: nextLots,
            verificado: nextProduct.verificado,
            updatedAt: nowTs
          });
          if (checked && difference !== 0) {
            adjustmentMovement = {
              id: movementId,
              productoCodigo: serverProduct.codigo,
              productoNombre: serverProduct.nombre,
              lote: nextLot.numeroLote,
              cantidad: Math.abs(difference),
              precio: currentLot.precio,
              tipoMovimiento: "Ajuste",
              usuario: `${currentUser.nombre} (${currentUser.usuario})`,
              fecha: nowIso,
              timestamp: nowTs,
              catalogId: serverProduct.catalogId || activeCatalogId
            };
            transaction.set(tenantDoc("movimientos", movementId, activeFarmaciaId), adjustmentMovement);
          }
          updatedProduct = nextProduct;
        });
      }

      if (!updatedProduct) throw new Error("No se pudo confirmar el ajuste del lote.");
      setProducts((previous) => previous.map((product) =>
        product.codigo === selectedProductCode ? updatedProduct! : product
      ));
      const adjustedLot = updatedProduct.lotes.find((lot) => lot.id === lotId);
      if (adjustedLot) {
        setEditLotes((previous) => previous.map((lot) =>
          lot.id === lotId
            ? {
                ...lot,
                cantidad: adjustedLot.cantidad,
                numeroLote: adjustedLot.numeroLote,
                fechaVencimiento: adjustedLot.fechaVencimiento,
                articuloAjustado: adjustedLot.articuloAjustado
              }
            : lot
        ));
      }
      if (adjustmentMovement) {
        logSystemEvent(`📦 **Ajuste de Inventario**: ${sourceProduct.nombre}, lote ${adjustmentMovement.lote}, cantidad ajustada ${adjustmentMovement.cantidad} por ${currentUser.nombre}.`);
        playSound("positive");
        showToast(`Lote ${adjustmentMovement.lote} ajustado y guardado. Se registró el movimiento de inventario.`);
      } else {
        playSound("positive");
        showToast(checked ? "Lote ajustado y guardado correctamente." : "Marca «Ajustado» retirada.");
      }
    } catch (error) {
      console.error("Error ajustando inventario:", error);
      playSound("negative");
      showToast(error instanceof Error ? error.message : "No se pudo guardar el ajuste del inventario.");
    } finally {
      setAdjustingLotIds((previous) => previous.filter((id) => id !== lotId));
    }
  };

  // Delete Lot inside Detail Modal
  const handleDeleteLot = (lotId: string) => {
    if (editLotes.length <= 1) {
      alert("No se puede eliminar el único lote. Elimine el producto completo si es necesario.");
      return;
    }
    if (confirm("¿Deseas eliminar este lote? Esta acción no se puede deshacer.")) {
      setEditLotes((prev) => prev.filter((l) => l.id !== lotId));
      playSound("negative");
    }
  };

  // Add Lot inside Detail Modal
  const handleAddLot = async () => {
    if (!selectedProductCode) return;
    const lotNum = newLotNum.trim();
    const qty = Number(newLotQty);
    const qtyF = newLotQtyF.trim() !== "" ? Number(newLotQtyF) : qty;
    const exp = newLotExpDate;
    const price = Number(newLotPrice);

    if (!lotNum || isNaN(qty) || qty < 0 || !exp || isNaN(price)) {
      alert("Completa todos los campos obligatorios (*) para añadir el lote.");
      return;
    }

    const lotId = `lote-${selectedProductCode}-${Date.now()}`;
    const newLot: Lote = {
      id: lotId,
      numeroLote: lotNum,
      cantidad: qty,
      cantidadF: qtyF,
      fechaVencimiento: exp,
      precio: price,
      loteFisico: newLotLocation.trim() || "Almacén",
      fechaFisica: newLotPhysExpDate || exp
    };

    setEditLotes((prev) => [...prev, newLot]);
    setCoincidenLotesMap((prev) => ({ ...prev, [lotId]: qty === qtyF }));

    // Log the movement as Input (Entrada)
    const activeProd = products.find((p) => p.codigo === selectedProductCode)!;
    const movLog: Omit<Movimiento, "id"> = {
      productoCodigo: activeProd.codigo,
      productoNombre: activeProd.nombre,
      lote: lotNum,
      cantidad: qty,
      precio: price,
      tipoMovimiento: "Entrada",
      usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema",
      fecha: new Date().toISOString(),
      timestamp: Date.now()
    };
    await saveMovementLog(movLog);

    setShowLotAdd(false);
    setNewLotNum("");
    setNewLotQty("");
    setNewLotQtyF("");
    setNewLotLocation("");
    setNewLotExpDate("");
    setNewLotPhysExpDate("");
    setNewLotPrice("");
    playSound("action");
    showToast(`Lote "${lotNum}" añadido temporalmente. Guarda los cambios para aplicar.`);
  };

  // Save details and lot changes
  const handleSaveDetails = async () => {
    if (!selectedProductCode) return;
    const prod = products.find((p) => p.codigo === selectedProductCode);
    if (!prod) return;

    // Detect adjustments (differences in quantity) to log them
    const adjustments: Omit<Movimiento, "id">[] = [];
    editLotes.forEach((l) => {
      const orig = prod.lotes.find((ol) => ol.id === l.id);
      if (orig) {
        const diff = Number(l.cantidad || 0) - Number(orig.cantidad || 0);
        if (diff !== 0) {
          adjustments.push({
            productoCodigo: prod.codigo,
            productoNombre: prod.nombre,
            lote: l.numeroLote,
            cantidad: Math.abs(diff),
            precio: l.precio,
            tipoMovimiento: "Ajuste",
            usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema",
            fecha: new Date().toISOString(),
            timestamp: Date.now()
          });
        }
      }
    });

    const productWithoutLegacyImages = { ...prod };
    delete productWithoutLegacyImages.imagen;
    delete productWithoutLegacyImages.imagenURL;
    const updatedProduct: Producto = {
      ...productWithoutLegacyImages,
      ...(editImages[0] ? { imagen: editImages[0], imagenURL: editImages[0] } : {}),
      imagenes: editImages,
      nombre: editName.trim() || prod.nombre,
      descripcion: editDesc.trim(),
      lotes: editLotes
    };

    try {
      await saveProductDoc(updatedProduct);
      for (const adj of adjustments) {
        await saveMovementLog(adj);
      }

      setSelectedProductCode(null);
      playSound("positive");
      showToast("Los cambios del suministro se han guardado con éxito.");
    } catch (error) {
      console.error("Error guardando los cambios del suministro:", error);
      playSound("negative");
      showToast(error instanceof Error ? error.message : "Error al guardar cambios. Inténtalo nuevamente.");
    }
  };

  // Confirm & Save Photo directly to Firebase Firestore (compressed WebP/JPEG)
  const handleConfirmProductPhoto = async (compressedDataUrl: string) => {
    if (!selectedProductCode) return;

    setIsPhotoUploading(true);
    try {
      const prod = products.find((p) => p.codigo === selectedProductCode);
      if (prod) {
        const updated = { ...prod, imagen: compressedDataUrl, imagenURL: compressedDataUrl };
        await saveProductDoc(updated);
        setPendingDetailPhoto(null);
        showToast("Foto confirmada y guardada en Firebase correctamente");
        playSound("positive");
      }
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : "Error al guardar la imagen");
      playSound("negative");
    } finally {
      setIsPhotoUploading(false);
    }
  };

  // Upload Photo directly to Firebase Firestore (compressed WebP/JPEG)
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProductCode) return;

    setIsPhotoUploading(true);
    playSound("open");

    try {
      const compressedDataUrl = await Ni(file);
      await handleConfirmProductPhoto(compressedDataUrl);
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : "Error al procesar la imagen");
      playSound("negative");
    } finally {
      setIsPhotoUploading(false);
      e.target.value = "";
    }
  };

  const handlePhotoDelete = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!selectedProductCode) return;

    const prod = products.find((p) => p.codigo === selectedProductCode);
    if (prod) {
      const { imagen, imagenURL, ...cleaned } = prod;
      await saveProductDoc(cleaned as Producto);
      setPendingDetailPhoto(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      showToast("Foto eliminada correctamente");
      playSound("negative");
    }
  };

  const generateNextCode = (currentCatalogId: string, customPrefix?: string): string => {
    const catalogProducts = products.filter(p => matchesCatalog(p.catalogId, currentCatalogId, catalogos));
    let prefix = customPrefix || "B";

    if (!customPrefix && catalogProducts.length > 0) {
      const prefixCount: Record<string, number> = {};
      catalogProducts.forEach(p => {
        const match = p.codigo.match(/^([A-Z]+)/i);
        if (match) {
          const pref = match[1].toUpperCase();
          prefixCount[pref] = (prefixCount[pref] || 0) + 1;
        }
      });

      let maxCount = 0;
      let bestPrefix = "";
      for (const pref in prefixCount) {
        if (prefixCount[pref] > maxCount) {
          maxCount = prefixCount[pref];
          bestPrefix = pref;
        }
      }
      if (bestPrefix) {
        prefix = bestPrefix;
      }
    }

    const numbers: number[] = [];
    products.forEach(p => {
      const regex = new RegExp(`^${prefix}(\\d+)`, "i");
      const match = p.codigo.match(regex);
      if (match) {
        numbers.push(parseInt(match[1], 10));
      }
    });

    let nextNum = 1;
    if (numbers.length > 0) {
      nextNum = Math.max(...numbers) + 1;
    }

    let padLength = 3;
    const samePrefixProducts = products.filter(p => p.codigo.toUpperCase().startsWith(prefix));
    if (samePrefixProducts.length > 0) {
      const firstCode = samePrefixProducts[0].codigo;
      const digitMatch = firstCode.match(/\d+/);
      if (digitMatch) {
        padLength = digitMatch[0].length;
      }
    }

    const formattedNum = String(nextNum).padStart(padLength, "0");
    const candidateCode = `${prefix}${formattedNum}`;

    let finalCode = candidateCode;
    let increment = 1;
    while (products.some(p => p.codigo === finalCode)) {
      finalCode = `${prefix}${String(nextNum + increment).padStart(padLength, "0")}`;
      increment++;
    }

    return finalCode;
  };

  // Add a product to the temporary pending invoice list (Section 2 -> Section 3 of Image 3)
  const handleAddPendingEntryItem = () => {
    let code = newProdCode.trim().toUpperCase();
    const name = newProdName.trim();
    const desc = newProdDesc.trim();
    const lotNum = newProdLotNum.trim();
    const qty = Number(newProdLotQty);
    const qtyF = newProdLotQtyF.trim() !== "" ? Number(newProdLotQtyF) : qty;
    const exp = newProdLotExpDate;
    const price = Number(newProdLotPrice);

    if (!name || !lotNum || isNaN(qty) || qty <= 0 || !exp || isNaN(price) || price < 0) {
      alert("Completa los campos obligatorios del producto (*): Nombre, Lote, Cantidad (>0), Costo Unitario y Fecha de Vencimiento.");
      return;
    }

    if (!code) {
      // Check if an existing product matches by name or generate next code taking pending items into account
      const existingByName = products.find(
        (p) =>
          matchesCatalog(p.catalogId, activeCatalogId, catalogos) &&
          p.nombre.toLowerCase() === name.toLowerCase()
      );
      if (existingByName) {
        code = existingByName.codigo;
      } else {
        let baseCode = generateNextCode(activeCatalogId);
        let suffix = 1;
        while (pendingEntryItems.some((it) => it.codigo === baseCode)) {
          const match = baseCode.match(/^([A-Z]+)(\d+)$/i);
          if (match) {
            const pref = match[1];
            const num = parseInt(match[2], 10) + suffix;
            baseCode = `${pref}${String(num).padStart(match[2].length, "0")}`;
          } else {
            baseCode = `${baseCode}-${suffix}`;
          }
          suffix++;
        }
        code = baseCode;
      }
    }

    const existingProduct = products.find((product) => product.codigo === code);
    const existingImages = existingProduct ? getProductImages(existingProduct) : [];
    const finalPhotos = existingProduct && newProdPhotoProductCode !== existingProduct.codigo
      ? [...existingImages, ...newProdPhotos]
      : newProdPhotos;
    if (finalPhotos.length > 3) {
      showToast(`El producto admite hasta 3 fotografías. Ya tiene ${existingImages.length}; elimina o reemplaza alguna antes de continuar.`);
      playSound("negative");
      return;
    }

    const newItem = {
      tempId: `pend-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      codigo: code,
      nombre: name,
      descripcion: desc,
      numeroLote: lotNum,
      loteFisico: newProdLotLocation.trim() || "Almacén",
      cantidad: qty,
      cantidadF: qtyF,
      precio: price,
      fechaVencimiento: exp,
      fechaFisica: newProdLotPhysExpDate || exp,
      ...(finalPhotos.length > 0 ? { imagen: finalPhotos[0], imagenes: finalPhotos } : {})
    };

    setPendingEntryItems((prev) => [...prev, newItem]);

    // Clear only product fields so user can keep adding more items under the same invoice
    setNewProdCode("");
    setNewProdName("");
    setNewProdDesc("");
    setNewProdLotNum("");
    setNewProdLotQty("");
    setNewProdLotQtyF("");
    setNewProdLotLocation("");
    setNewProdLotExpDate("");
    setNewProdLotPhysExpDate("");
    setNewProdLotPrice("");
    setNewProdPhoto("");
    setPendingNewProdPhoto(null);
    setNewProdPhotos([]);
    setNewProdPhotoProductCode(null);
    playSound("action");
    showToast(`"${name}" añadido a la lista de entrada.`);
  };

  const handleRemovePendingEntryItem = (tempId: string) => {
    setPendingEntryItems((prev) => prev.filter((it) => it.tempId !== tempId));
    playSound("click");
  };

  // Confirm entire invoice entry (Section 3 Footer of Image 3)
  const handleAddProductSubmit = async () => {
    if (confirmingEntry) return;

    const cleanInvoiceNum = invoiceNum.trim().toUpperCase();
    const cleanInvoiceDate = invoiceDate || new Date().toISOString().slice(0, 10);
    const cleanSupplier = invoiceSupplier.trim();

    if (!cleanInvoiceNum) {
      alert("Ingresa el N.º de Factura / Comprobante (*) en la sección 1 antes de confirmar la entrada.");
      return;
    }

    if (pendingEntryItems.length === 0) {
      alert('Agrega al menos un producto a la lista usando el botón "+ Añadir a la Lista de Entrada".');
      return;
    }

    setConfirmingEntry(true);
    playSound("action");

    try {
      // Group pending items by product code so multiple lots for the same product merge cleanly
      const updatedProductsMap = new Map<string, Producto>();

      for (const item of pendingEntryItems) {
        const existingProd =
          updatedProductsMap.get(item.codigo) ||
          products.find((p) => p.codigo === item.codigo);

        const newLot: Lote = {
          id: `lote-${item.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          numeroLote: item.numeroLote,
          cantidad: item.cantidad,
          cantidadF: item.cantidadF,
          fechaVencimiento: item.fechaVencimiento,
          precio: item.precio,
          loteFisico: item.loteFisico || "Almacén",
          fechaFisica: item.fechaFisica || item.fechaVencimiento
        };

        if (existingProd) {
          const merged: Producto = {
            ...existingProd,
            nombre: item.nombre || existingProd.nombre,
            descripcion: item.descripcion || existingProd.descripcion || "",
            lotes: [...existingProd.lotes, newLot],
            ...(item.imagenes?.length
              ? { imagen: item.imagenes[0], imagenURL: item.imagenes[0], imagenes: item.imagenes }
              : item.imagen ? { imagen: item.imagen, imagenURL: item.imagen } : {}),
            updatedAt: Date.now()
          };
          updatedProductsMap.set(item.codigo, merged);
        } else {
          const created: Producto = {
            codigo: item.codigo,
            nombre: item.nombre,
            descripcion: item.descripcion,
            lotes: [newLot],
            ...(item.imagenes?.length
              ? { imagen: item.imagenes[0], imagenURL: item.imagenes[0], imagenes: item.imagenes }
              : item.imagen ? { imagen: item.imagen, imagenURL: item.imagen } : {}),
            updatedAt: Date.now(),
            catalogId: activeCatalogId
          };
          updatedProductsMap.set(item.codigo, created);
        }
      }

      const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
      if (isLocalFileMode) {
        for (const prod of updatedProductsMap.values()) {
          await saveProductDoc(prod);
        }
        for (const item of pendingEntryItems) {
          const movLog: Omit<Movimiento, "id"> = {
            productoCodigo: item.codigo,
            productoNombre: item.nombre,
            descripcion: item.descripcion,
            lote: item.numeroLote,
            loteFisico: item.loteFisico,
            cantidad: item.cantidad,
            cantidadF: item.cantidadF,
            fechaVencimiento: item.fechaVencimiento,
            fechaFisica: item.fechaFisica,
            precio: item.precio,
            tipoMovimiento: "Entrada",
            usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema",
            fecha: new Date().toISOString(),
            timestamp: Date.now(),
            catalogId: activeCatalogId,
            numeroFactura: cleanInvoiceNum,
            fechaEntrada: cleanInvoiceDate,
            proveedor: cleanSupplier
          };
          await saveMovementLog(movLog);
        }
      } else {
        // Save all affected products and movement logs in a single atomic batch for instant response
        const batch = writeBatch(db);
        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();
        const userLabel = currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema";

        for (const prod of updatedProductsMap.values()) {
          const ref = tenantDoc("productos", prod.codigo.replace(/\//g, "_"), activeFarmaciaId);
          const allAdjusted = prod.lotes.length > 0 && prod.lotes.every((l) => !!l.articuloAjustado);
          const finalVerified = allAdjusted ? false : (prod.verificado || false);
          batch.set(ref, {
            ...prod,
            catalogId: prod.catalogId || activeCatalogId,
            verificado: finalVerified,
            updatedAt: nowTs
          });
        }

        for (const item of pendingEntryItems) {
          const movId = `mov-${item.codigo}-${nowTs}-${Math.random().toString(36).slice(2, 6)}`;
          const movData: Movimiento = {
            id: movId,
            productoCodigo: item.codigo,
            productoNombre: item.nombre,
            descripcion: item.descripcion,
            lote: item.numeroLote,
            loteFisico: item.loteFisico,
            cantidad: item.cantidad,
            cantidadF: item.cantidadF,
            fechaVencimiento: item.fechaVencimiento,
            fechaFisica: item.fechaFisica,
            precio: item.precio,
            tipoMovimiento: "Entrada",
            usuario: userLabel,
            fecha: nowIso,
            timestamp: nowTs,
            catalogId: activeCatalogId,
            numeroFactura: cleanInvoiceNum,
            fechaEntrada: cleanInvoiceDate,
            proveedor: cleanSupplier
          };
          batch.set(tenantDoc("movimientos", movId, activeFarmaciaId), movData);
        }

        await batch.commit();
        logSystemEvent(`📦 **Movimiento de Inventario**: Se registró una **Entrada** de ${pendingEntryItems.length} producto(s) bajo la factura **${cleanInvoiceNum}** por el usuario ${userLabel}.`);
      }

      const count = pendingEntryItems.length;
      setPendingEntryItems([]);
      setInvoiceNum("");
      setInvoiceDate(new Date().toISOString().slice(0, 10));
      setInvoiceSupplier("");
      setShowProductAdd(false);
      playSound("positive");
      showToast(`Entrada confirmada: ${count} producto(s) registrados bajo la factura ${cleanInvoiceNum}.`);
    } catch (err) {
      console.error("Error confirming invoice entry:", err);
      alert("Ocurrió un error al confirmar la entrada de productos.");
    } finally {
      setConfirmingEntry(false);
    }
  };

  // Block Selection
  const handleSelectBlock = (blockId: string | null) => {
    setSelectedBlock(blockId);
    setBlockLevelFilter("todos");
    setBlockAddMode(null);
  };

  const handleAddSupplyToBlockConfirm = async (level: number) => {
    if (!selectedBlock || !blockAddProduct) return;
    const block = blocks.find((b) => b.id === selectedBlock) || { id: selectedBlock, items: [] };

    if ((block.items || []).some((item: any) => item.productCode === blockAddProduct)) {
      alert("Este medicamento ya está asignado a este bloque.");
      return;
    }

    const newItem = {
      id: `blockitem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productCode: blockAddProduct,
      nivel: level
    };

    const updatedItems = [...(block.items || []), newItem];
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    if (isLocalFileMode) {
      setBlocks(prev => prev.map(b => b.id === selectedBlock ? { ...b, items: updatedItems, updatedAt: Date.now() } : b));
    } else {
      const docRef = tenantDoc("bloques", selectedBlock, activeFarmaciaId);
      await updateDoc(docRef, { items: updatedItems, updatedAt: Date.now() });
    }

    setBlockAddProduct(null);
    setBlockAddMode(null);
    playSound("positive");
    showToast("Medicamento posicionado en el bloque");
  };

  const handleRemoveSupplyFromBlock = async (itemId: string) => {
    if (!selectedBlock) return;
    const block = blocks.find((b) => b.id === selectedBlock)!;
    const updatedItems = block.items.filter((item: any) => item.id !== itemId);
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    
    if (isLocalFileMode) {
      setBlocks(prev => prev.map(b => b.id === selectedBlock ? { ...b, items: updatedItems, updatedAt: Date.now() } : b));
    } else {
      const docRef = tenantDoc("bloques", selectedBlock, activeFarmaciaId);
      await updateDoc(docRef, { items: updatedItems, updatedAt: Date.now() });
    }
    playSound("negative");
    showToast("Medicamento removido del bloque");
  };

  // Order List item modifiers
  const handleSetOrderCatalogId = (catId: string) => {
    const allowedCats = getUserAvailableCatalogos(currentUser, catalogos);
    const allowed = allowedCats.some((c: any) => c.id === catId);
    if (catId && !allowed) {
      showToast("No tiene permisos para acceder a este catálogo.");
      return;
    }

    if (orderItems.length > 0) {
      const confirmChange = window.confirm("Cambiar el catálogo eliminará los productos ya seleccionados en el pedido actual. ¿Desea continuar?");
      if (!confirmChange) return;
      setOrderItems([]);
    }
    setOrderCatalogId(catId);
    playSound("click");
  };

  const handleSelectOrderProduct = (code: string | null) => {
    setOrderSelectedProduct(code);
    setOrderSelectedLot(null);
    setOrderSelectedQuantity(null);
  };

  const handleAddOrderItem = () => {
    if (!orderSelectedProduct || !orderSelectedLot || !orderSelectedQuantity) return;
    const prod = products.find((p) => p.codigo === orderSelectedProduct);
    const lot = prod?.lotes.find((l) => l.id === orderSelectedLot);

    if (!prod || !lot) return;

    if (orderItems.some((item) => item.productCode === prod.codigo && item.loteId === lot.id)) {
      playSound("negative");
      showToast("Este lote ya ha sido añadido al pedido actual. Puedes ajustar su cantidad en la tabla.");
      return;
    }

    const stockSistema = Number(lot.cantidad || 0);
    const stockFisico = Number(lot.cantidadF || 0);
    const maxAvailableBoth = Math.min(stockSistema, stockFisico);

    if (orderSelectedQuantity <= 0) {
      playSound("negative");
      showToast("La cantidad solicitada debe ser mayor a cero.");
      return;
    }

    if (stockSistema <= 0 || stockFisico <= 0 || orderSelectedQuantity > stockSistema || orderSelectedQuantity > stockFisico) {
      playSound("negative");
      const msg =
        `No se puede agregar "${prod.nombre}" (Lote ${lot.numeroLote}): cantidad solicitada (${orderSelectedQuantity} und.) supera las existencias disponibles. ` +
        `Disponible en Sistema: ${stockSistema} und. | Disponible en Físico: ${stockFisico} und. (Máximo permitido: ${maxAvailableBoth} und.)`;
      showToast(msg);
      return;
    }

    const newItem = {
      productCode: prod.codigo,
      codigo: prod.codigo,
      nombre: prod.nombre,
      descripcion: prod.descripcion,
      loteId: lot.id,
      loteNumero: lot.numeroLote,
      fecha: lot.fechaVencimiento,
      precio: lot.precio,
      cantidadAprobada: orderSelectedQuantity
    };

    setOrderItems((prev) => [...prev, newItem]);
    setOrderSelectedLot(null);
    setOrderSelectedQuantity(null);
    playSound("action");
    showToast("Añadido al pedido");
  };

  const handleCompleteOrder = async () => {
    if (orderItems.length === 0) return;

    // 1. Validación en la interfaz (UI) verificando tanto inventario del sistema como inventario físico
    const lotTotalsMap = new Map<string, { productCode: string; loteId: string; loteNumero: string; nombre: string; totalQty: number }>();
    for (const item of orderItems) {
      const key = `${item.productCode}::${item.loteId}`;
      const prev = lotTotalsMap.get(key);
      if (prev) {
        prev.totalQty += Number(item.cantidadAprobada || 0);
      } else {
        lotTotalsMap.set(key, {
          productCode: item.productCode,
          loteId: item.loteId,
          loteNumero: item.loteNumero,
          nombre: item.nombre,
          totalQty: Number(item.cantidadAprobada || 0)
        });
      }
    }

    for (const entry of lotTotalsMap.values()) {
      const prod = products.find((p) => p.codigo === entry.productCode);
      const lot = prod?.lotes.find((l) => l.id === entry.loteId);
      const stockSistema = lot ? Number(lot.cantidad || 0) : 0;
      const stockFisico = lot ? Number(lot.cantidadF || 0) : 0;
      if (!prod || !lot || entry.totalQty <= 0 || entry.totalQty > stockSistema || entry.totalQty > stockFisico) {
        playSound("negative");
        showToast(
          `Stock insuficiente en lote "${entry.loteNumero}" de "${entry.nombre}". Solicitado: ${entry.totalQty} und. | Disponible en Sistema: ${stockSistema} und. | Físico: ${stockFisico} und.`
        );
        return;
      }
    }

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    try {
      if (isLocalFileMode) {
        // 1. Process products and update React state directly
        const updatedProducts = products.map((p) => {
          const matchingItems = orderItems.filter((item) => item.productCode === p.codigo);
          if (matchingItems.length > 0) {
            let nextLotes = [...p.lotes];
            for (const item of matchingItems) {
              nextLotes = nextLotes.map((l) => {
                if (l.id === item.loteId) {
                  const nextQty = Math.max(0, Number(l.cantidad || 0) - item.cantidadAprobada);
                  const nextQtyF = Math.max(0, Number(l.cantidadF || 0) - item.cantidadAprobada);
                  return { ...l, cantidad: nextQty, cantidadF: nextQtyF };
                }
                return l;
              });
            }
            return { ...p, lotes: nextLotes, verificado: false, updatedAt: Date.now() };
          }
          return p;
        });
        setProducts(updatedProducts);
      } else {
        // 2. Validación e integridad transaccional en el servidor (Firestore runTransaction)
        // Evita registros con cantidades superiores a las disponibles incluso ante solicitudes simultáneas
        const uniqueProductCodes = Array.from(new Set<string>(orderItems.map((it) => it.productCode)));
        const nowTs = Date.now();
        const nowIso = new Date(nowTs).toISOString();
        const userLabel = currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema";

        await runTransaction(db, async (transaction) => {
          // Leer documentos actuales desde el servidor dentro de la transacción
          const prodSnaps = await Promise.all(
            uniqueProductCodes.map((code) =>
              transaction.get(tenantDoc("productos", code.replace(/\//g, "_"), activeFarmaciaId))
            )
          );

          const serverProductsMap = new Map<string, Producto>();
          prodSnaps.forEach((snap, idx) => {
            const code = uniqueProductCodes[idx];
            if (!snap.exists()) {
              throw new Error(`El producto "${code}" ya no existe en el servidor.`);
            }
            serverProductsMap.set(code, snap.data() as Producto);
          });

          // Verificar existencias en tiempo real en ambos inventarios (Sistema y Físico) y descontar
          for (const item of orderItems) {
            const serverProd = serverProductsMap.get(item.productCode);
            if (!serverProd) {
              throw new Error(`Producto "${item.nombre}" no encontrado en el servidor.`);
            }
            const targetLot = (serverProd.lotes || []).find((l) => l.id === item.loteId);
            if (!targetLot) {
              throw new Error(`El lote "${item.loteNumero}" de "${item.nombre}" no se encontró en el servidor.`);
            }

            const serverSistema = Number(targetLot.cantidad || 0);
            const serverFisico = Number(targetLot.cantidadF || 0);
            const reqQty = Number(item.cantidadAprobada || 0);

            if (reqQty <= 0 || reqQty > serverSistema || reqQty > serverFisico) {
              throw new Error(
                `Stock insuficiente en el servidor para "${item.nombre}" (Lote ${item.loteNumero}). Solicitado: ${reqQty} und. | Disponible en Sistema: ${serverSistema} und. | Disponible en Físico: ${serverFisico} und.`
              );
            }

            targetLot.cantidad = serverSistema - reqQty;
            targetLot.cantidadF = serverFisico - reqQty;
          }

          // Escribir los productos actualizados y los movimientos de salida atómicamente
          for (const [code, updatedProd] of serverProductsMap.entries()) {
            const prodRef = tenantDoc("productos", code.replace(/\//g, "_"), activeFarmaciaId);
            transaction.set(prodRef, {
              ...updatedProd,
              verificado: false,
              updatedAt: nowTs
            });
          }

          for (const item of orderItems) {
            const movId = `mov-${item.productCode}-${nowTs}-${Math.random().toString(36).slice(2, 6)}`;
            const movRef = tenantDoc("movimientos", movId, activeFarmaciaId);
            const mov: Movimiento = {
              id: movId,
              productoCodigo: item.productCode,
              productoNombre: item.nombre,
              lote: item.loteNumero,
              cantidad: item.cantidadAprobada,
              cantidadF: item.cantidadAprobada,
              precio: item.precio,
              tipoMovimiento: "Salida",
              usuario: userLabel,
              fecha: nowIso,
              timestamp: nowTs,
              catalogId: orderCatalogId || activeCatalogId
            };
            transaction.set(movRef, mov);
          }
        });
      }

      // Download plain TXT file
      downloadOrderFile();
      setOrderItems([]);
      setOrderCatalogId("");
      setShowOrder(false);
      playSound("positive");
      showToast("Pedido completado e inventario actualizado.");
    } catch (err: any) {
      console.error("Error completing order:", err);
      playSound("negative");
      showToast(err?.message || "Error al completar el pedido");
    }
  };

  const downloadOrderFile = () => {
    const textLines = ["PEDIDO DE SALIDA DE MEDICAMENTOS Y SUMINISTROS", `Fecha: ${new Date().toLocaleString()}`, ""];
    orderItems.forEach((item, idx) => {
      textLines.push(`${idx + 1}. Código: ${item.codigo}`);
      textLines.push(`   Nombre: ${item.nombre}`);
      textLines.push(`   Lote: ${item.loteNumero}`);
      textLines.push(`   Fecha Vencimiento: ${new Date(item.fecha + "T00:00:00").toLocaleDateString()}`);
      textLines.push(`   Cantidad Despachada: ${item.cantidadAprobada}`);
      textLines.push(`   Precio: RD$ ${item.precio.toFixed(2)}`);
      textLines.push("");
    });

    const blob = new Blob([textLines.join("\r\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Pedido_Stock_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
  };

  const handleShareWhatsApp = () => {
    const textLines = ["*PEDIDO DE SALIDA DE MEDICAMENTOS*", ""];
    orderItems.forEach((item, idx) => {
      textLines.push(`*${idx + 1}. ${item.nombre}*`);
      textLines.push(`Código: ${item.codigo} • Lote: ${item.loteNumero}`);
      textLines.push(`Cantidad Despachada: ${item.cantidadAprobada}`);
      textLines.push("");
    });

    const url = `https://wa.me/?text=${encodeURIComponent(textLines.join("\n"))}`;
    window.open(url, "_blank");
  };

  const handleExport = (format: "pdf" | "word") => {
    const filtered = getFilteredProducts();
    if (filtered.length === 0) {
      showToast("No hay registros para exportar.");
      return;
    }
    
    const filterName = FILTROS_CATALOGO[catalogFilter] || catalogFilter;
    const activeCatalogName = catalogos.find((c) => c.id === activeCatalogId)?.nombre || "Medicamentos e Insumos";
    
    if (format === "pdf") {
      exportToPDF(filtered, filterName, activeCatalogName);
      showToast("Reporte PDF generado.");
    } else {
      exportToWord(filtered, filterName, activeCatalogName);
      showToast("Reporte Word generado.");
    }
    playSound("action");
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const triggerFileInput = () => {
    if (isPhotoUploading) return;
    fileInputRef.current?.click();
  };

  const enabledModules = getEnabledModules(currentUser);

  return (
    <>
      <style>{`
        :root {
          --color-primary: ${colores.primary};
          --color-sidebar: ${colores.sidebar};
          --color-buttons: ${colores.buttons};
          --color-headers: ${colores.headers};
          --color-cards: ${colores.cards};
          --color-tables: ${colores.tables};
          --color-elements: ${colores.elements};
        }
        
        .bg-custom-primary { background-color: var(--color-primary); }
        .text-custom-primary { color: var(--color-primary); }
        .border-custom-primary { border-color: var(--color-primary); }
        
        .bg-custom-sidebar { background-color: var(--color-sidebar); }
        .bg-custom-buttons { background-color: var(--color-buttons); }
        .bg-custom-headers { background-color: var(--color-headers); }
        .bg-custom-cards { background-color: var(--color-cards); }
        .bg-custom-tables { background-color: var(--color-tables); }
        .text-custom-headers { color: var(--color-headers); }

        .anim-card-in {
          animation: cardIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .anim-pop-in {
          animation: popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .anim-slide-up {
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes cardIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes popIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        .card-tap {
          transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.22s ease;
        }
        .card-tap:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 24px -10px rgba(15, 23, 42, 0.1), 0 4px 8px -4px rgba(15, 23, 42, 0.05);
          border-color: #cbd5e1;
        }
        .card-tap:active {
          transform: translateY(0px);
        }
        
        /* Custom scrollbar for chips filter */
        .chip-scroll::-webkit-scrollbar {
          height: 0px;
        }
      `}</style>

      {loading ? (
        <div className="bg-slate-100 text-slate-800 min-h-screen flex flex-col items-center justify-center p-6 font-sans">
          <div className="bg-white p-8 rounded-3xl shadow-md border border-slate-200/80 flex flex-col items-center max-w-sm w-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 p-2 mb-4 shadow-xs flex items-center justify-center">
              <img src={APP_ICON_PATH} alt="Farmacia" className="w-full h-full object-contain" />
            </div>
            <LoaderCircle className="w-7 h-7 animate-spin text-teal-600 mb-3" />
            <p className="text-base font-extrabold text-slate-800">Conectando con el sistema</p>
            <p className="text-xs font-semibold text-slate-500 mt-1">Verificando credenciales y catálogo activo...</p>
          </div>
        </div>
      ) : !currentUser ? (
        <Login
          users={users}
          isInitializingUsers={loading}
          onLoginSuccess={(user, farmaciaId, meta) => {
            const cleanTenant = setActiveFarmaciaId(farmaciaId || user.farmaciaId || DEFAULT_FARMACIA_ID);
            setActiveFarmaciaIdState(cleanTenant);
            if (meta) {
              setFarmaciaMeta(meta);
              localStorage.setItem("active_farmacia_meta", JSON.stringify(meta));
            }
            setIsFirebaseAuthed(true);
            setCurrentUser({ ...user, farmaciaId: cleanTenant });
            localStorage.setItem("current_user", JSON.stringify({ ...user, farmaciaId: cleanTenant }));
            showToast(`¡Bienvenido, ${user.nombre}!`);
            playSound("positive");
          }}
        />
      ) : (
        <div className="bg-slate-100/90 text-slate-800 min-h-screen pb-28 font-sans selection:bg-teal-600 selection:text-white">
          <header className="sticky top-0 z-30 text-white shadow-lg bg-custom-sidebar border-b border-white/10">
            <div className="max-w-6xl mx-auto px-3.5 sm:px-6 pt-3 pb-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3.5">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="cursor-pointer group flex items-center gap-2.5 min-w-0"
                  onClick={() => {
                    setActiveTab("dashboard");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                  }}
                >
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white p-1.5 shadow-sm flex items-center justify-center shrink-0 border border-white/20">
                    <img
                      src={APP_ICON_PATH}
                      alt="Icono de la Aplicación"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-base sm:text-2xl font-extrabold tracking-tight leading-tight flex items-center gap-2 group-hover:text-teal-200 transition-colors truncate">
                      <span className="truncate">{farmaciaMeta.nombre || "Control de Stock"}</span>
                    </h1>
                    <p className="text-teal-100/95 text-[11px] sm:text-[13px] font-semibold mt-0.5 truncate">
                      {farmaciaMeta.subtitulo || "Suministros Hospitalarios • Dr. José Manuel Rodríguez"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Selector Global de Catálogo */}
              <div className="flex flex-col gap-1 md:max-w-[280px] w-full md:mx-4 bg-black/15 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-2xl border border-white/15">
                <label className="text-[10px] font-extrabold uppercase text-teal-200 tracking-wider">
                  Catálogo Activo de Trabajo
                </label>
                <select
                  id="global-catalog-selector"
                  value={activeCatalogId}
                  onChange={(e) => {
                    setActiveCatalogId(e.target.value);
                    localStorage.setItem("active_catalog_id", e.target.value);
                    playSound("action");
                    showToast(`Catálogo: ${catalogos.find(c => c.id === e.target.value)?.nombre || "Cargando..."}`);
                  }}
                  className="bg-white/95 border border-white/40 rounded-xl px-3 py-1.5 text-xs sm:text-[13px] font-bold text-slate-900 outline-none focus:ring-2 focus:ring-teal-300 w-full cursor-pointer transition shadow-2xs"
                >
                  {getAvailableCatalogos().map((cat) => (
                    <option key={cat.id} value={cat.id} className="text-slate-800 font-semibold bg-white">
                      {cat.nombre}
                    </option>
                  ))}
                  {getAvailableCatalogos().length === 0 && (
                    <option value="default-cat" className="text-slate-800 font-semibold bg-white">
                      Medicamentos e Insumos Médicos
                    </option>
                  )}
                </select>
              </div>

              <div className="flex items-center justify-end gap-1.5 sm:gap-2.5 flex-wrap self-end md:self-auto w-full md:w-auto">
                <div className="text-left sm:text-right bg-black/15 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-xl border border-white/10 mr-auto md:mr-0">
                  <p className="text-[11px] sm:text-xs font-extrabold leading-tight text-white truncate max-w-[120px] sm:max-w-none">{currentUser.nombre}</p>
                  <p className="text-[9px] sm:text-[10px] font-bold text-teal-200 uppercase tracking-wider mt-0.5">{currentUser.rol}</p>
                </div>

                <PWAInstallButton variant="header" />

                <button
                  onClick={handleToggleMute}
                  className="p-2 sm:p-2.5 bg-white/10 hover:bg-white/20 active:scale-95 transition rounded-xl text-white border border-white/10 shadow-xs flex items-center justify-center cursor-pointer shrink-0"
                  title={isMuted ? "Activar Sonidos" : "Silenciar"}
                >
                  {isMuted ? <VolumeX className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-rose-300" /> : <Volume2 className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-emerald-300" />}
                </button>

                {activeFarmaciaId !== DEFAULT_FARMACIA_ID &&
                  currentUser.usuario.toLowerCase() === "anyer" && (
                    <button
                      onClick={() => {
                        const cleanTenant = setActiveFarmaciaId(DEFAULT_FARMACIA_ID);
                        setActiveFarmaciaIdState(cleanTenant);
                        const defaultMeta = {
                          nombre: "Control de Stock",
                          subtitulo: "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
                        };
                        setFarmaciaMeta(defaultMeta);
                        localStorage.setItem("active_farmacia_meta", JSON.stringify(defaultMeta));
                        const updatedUser = { ...currentUser, farmaciaId: cleanTenant };
                        setCurrentUser(updatedUser);
                        localStorage.setItem("current_user", JSON.stringify(updatedUser));
                        setActiveCatalogId("default-cat");
                        setActiveTab("configuracion");
                        playSound("positive");
                        showToast("Regresaste a la Sede Principal.");
                      }}
                      className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 active:scale-95 transition rounded-xl px-2.5 py-2 sm:px-3.5 sm:py-2.5 text-[11px] sm:text-xs font-extrabold uppercase tracking-wider shadow-sm cursor-pointer shrink-0"
                      title="Volver a la Sede Principal"
                    >
                      <span>🏥 Principal</span>
                    </button>
                  )}

                {enabledModules.includes("inventory") && (
                  <button
                    onClick={() => {
                      setCatalogFilter("todos");
                      setSearchTerm("");
                      setSelectedBlock(null);
                      setShowBlocks(false);
                      setShowOrder(false);
                      navigateToTab("inventory");
                      playSound("click");
                    }}
                    className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-600 active:scale-95 transition rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 text-[11px] sm:text-xs font-extrabold uppercase tracking-wider shadow-sm border border-white/15 cursor-pointer bg-custom-buttons shrink-0"
                  >
                    <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Inventario</span>
                  </button>
                )}

                <button
                  onClick={async () => {
                    try {
                      await signOut(auth);
                    } catch (e) {}
                    setCurrentUser(null);
                    setUsers([]);
                    setProducts([]);
                    localStorage.removeItem("current_user");
                    playSound("close");
                    showToast("Sesión cerrada correctamente");
                  }}
                  title="Cerrar Sesión"
                  className="flex items-center justify-center bg-black/25 hover:bg-rose-600 active:scale-95 transition rounded-xl p-2 sm:p-2.5 text-white border border-white/10 shadow-xs cursor-pointer shrink-0"
                >
                  <LogOut className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </button>
              </div>
            </div>

            {/* Menu Tabs Navigation */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-3 pt-1 flex overflow-x-auto chip-scroll items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  navigateToTab("dashboard");
                  playSound("click");
                }}
                className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  activeTab === "dashboard"
                    ? "bg-white text-teal-900 font-extrabold shadow-sm"
                    : "bg-white/10 text-teal-50 hover:bg-white/20"
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Dashboard</span>
              </button>

              {enabledModules.includes("inventory") && (
                <button
                  onClick={() => {
                    navigateToTab("inventory");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "inventory" && !selectedBlock && !showOrder
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <Package className="w-4 h-4" />
                  <span>Suministros</span>
                </button>
              )}

              {enabledModules.includes("venta") && (
                <button
                  onClick={() => {
                    navigateToTab("venta");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "venta"
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <Receipt className="w-4 h-4" />
                  <span>Venta</span>
                </button>
              )}

              {enabledModules.includes("carga_masiva") && (
                <button
                  onClick={() => {
                    navigateToTab("carga_masiva");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "carga_masiva"
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Carga Masiva</span>
                </button>
              )}

              {/* Solicitudes & Órdenes (Shared/Collapsible panel based on role) */}
              {enabledModules.includes("solicitudes") && (
                <button
                  onClick={() => {
                    navigateToTab("solicitudes");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "solicitudes"
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  <span>{currentUser.rol === "Administrador" ? "Órdenes" : "Solicitudes"}</span>
                </button>
              )}

              {enabledModules.includes("historial") && (
                <button
                  onClick={() => {
                    navigateToTab("historial");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "historial"
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span>Historial Movs</span>
                </button>
              )}

              {enabledModules.includes("usuarios") && (
                <button
                  onClick={() => {
                    navigateToTab("usuarios");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "usuarios"
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>Personal</span>
                </button>
              )}

              {enabledModules.includes("configuracion") && (
                <button
                  onClick={() => {
                    navigateToTab("configuracion");
                    playSound("click");
                  }}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-[13px] font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    activeTab === "configuracion"
                      ? "bg-white text-teal-900 font-extrabold shadow-sm"
                      : "bg-white/10 text-teal-50 hover:bg-white/20"
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  <span>Configurar</span>
                </button>
              )}

              {enabledModules.includes("inventory") && (
                <>
                  <div className="h-6 w-px bg-white/20 hidden sm:block mx-1"></div>

                  <button
                    onClick={() => {
                      setActiveTab("inventory");
                      setShowBlocks(!showBlocks);
                      setSelectedBlock(null);
                      playSound("click");
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 border transition text-xs sm:text-[13px] font-bold active:scale-95 cursor-pointer whitespace-nowrap ${
                      showBlocks
                        ? "bg-white text-teal-900 border-white font-extrabold shadow-sm"
                        : "bg-white/10 text-teal-50 border-white/15 hover:bg-white/20"
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span>Bloques</span>
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab("inventory");
                      setShowBlocks(false);
                      setSelectedBlock(null);
                      setShowOrder(!showOrder);
                      playSound("click");
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 border transition text-xs sm:text-[13px] font-bold active:scale-95 cursor-pointer whitespace-nowrap ${
                      showOrder
                        ? "bg-white text-teal-900 border-white font-extrabold shadow-sm"
                        : "bg-white/10 text-teal-50 border-white/15 hover:bg-white/20"
                    }`}
                  >
                    <ShoppingCart className="w-4 h-4" />
                    <span>Pedido {orderItems.length > 0 && `(${orderItems.length})`}</span>
                  </button>
                </>
              )}
            </div>

            {showBlocks && enabledModules.includes("inventory") && (
              <div id="blockSelector" className="anim-card-in bg-black/20 border-t border-white/10">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-teal-200 font-extrabold self-center mr-2 uppercase tracking-wider">
                    Módulos de Almacén:
                  </span>
                  {BLOQUES.map((id) => {
                    const hasAssigned = blocks.find((b) => b.id === id)?.items.length > 0;
                    const isSelected = selectedBlock === id;
                    return (
                      <button
                        key={id}
                        onClick={() => handleSelectBlock(isSelected ? null : id)}
                        className={`rounded-xl px-3.5 py-1.5 text-xs font-extrabold transition cursor-pointer ${
                          isSelected
                            ? "bg-white text-teal-950 shadow-md scale-105"
                            : hasAssigned
                            ? "bg-teal-600/90 hover:bg-teal-500 text-white border border-teal-300/40"
                            : "bg-white/10 text-teal-100 hover:bg-white/20 border border-white/10"
                        }`}
                      >
                        B.{id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </header>

          {/* Buscador y Filtros del Catálogo */}
          {activeTab === "inventory" && enabledModules.includes("inventory") && !selectedBlock && !showOrder && (
            <div className="bg-white border-b border-slate-200/90 shadow-2xs">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 space-y-3.5">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Buscar medicamentos, insumos, códigos, lotes o presentación..."
                      value={searchQuery}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-50/90 hover:bg-white focus:bg-white text-slate-900 text-sm rounded-2xl border border-slate-300 pl-12 pr-10 py-3 outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 placeholder:text-slate-400 font-semibold transition"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm("")}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
                        title="Limpiar búsqueda"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUnverifiedOnly(prev => !prev);
                      playSound("click");
                    }}
                    className={`rounded-2xl px-5 py-3 text-xs font-extrabold transition flex items-center justify-center gap-2.5 cursor-pointer border shrink-0 ${
                      showUnverifiedOnly
                        ? "bg-amber-100 text-amber-900 border-amber-400 shadow-xs"
                        : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300"
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${showUnverifiedOnly ? "bg-amber-600 animate-pulse" : "bg-slate-400"}`}></span>
                    <span>Sin verificar</span>
                  </button>
                </div>

                <div className="flex gap-2 overflow-x-auto chip-scroll pb-1">
                  {Object.keys(FILTROS_CATALOGO).map((key) => {
                    const isSelected = catalogFilter === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setCatalogFilter(key);
                          playSound("click");
                        }}
                        className={`whitespace-nowrap text-xs font-extrabold px-4 py-2 rounded-xl border transition cursor-pointer ${
                          isSelected
                            ? "bg-teal-800 text-white border-teal-800 shadow-xs"
                            : "bg-slate-100/90 hover:bg-slate-200/80 text-slate-700 border-slate-200/80"
                        }`}
                      >
                        {FILTROS_CATALOGO[key]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <main className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
            {/* Contenido Principal */}
            {activeTab === "dashboard" && (
              <DashboardPanel
                currentUser={currentUser}
                products={products}
                catalogos={catalogos}
                activeCatalogId={activeCatalogId}
                activePeriod={activePeriod}
                onSelectCatalog={(catId) => {
                  setActiveCatalogId(catId);
                  localStorage.setItem("active_catalog_id", catId);
                  playSound("action");
                }}
                onNavigateTab={(tabId) => {
                  navigateToTab(tabId);
                  playSound("click");
                }}
                onNavigateInventoryFilter={(filterKey, catId) => {
                  if (catId) {
                    setActiveCatalogId(catId);
                    localStorage.setItem("active_catalog_id", catId);
                  }
                  setCatalogFilter(filterKey);
                  navigateToTab("inventory");
                  playSound("click");
                }}
                onOpenProductDetail={(code) => {
                  if (enabledModules.includes("inventory")) {
                    handleOpenDetails(code);
                  }
                }}
              />
            )}

            {activeTab === "venta" && enabledModules.includes("venta") && (
              <VentaPanel
                currentUser={currentUser}
                products={products}
                catalogos={catalogos}
                activeCatalogId={activeCatalogId}
                onSelectCatalog={(catId) => {
                  setActiveCatalogId(catId);
                  localStorage.setItem("active_catalog_id", catId);
                }}
                conceptos={conceptos}
                showToast={showToast}
                onProductsUpdated={(updated) => setProducts(updated)}
              />
            )}

            {activeTab === "carga_masiva" && enabledModules.includes("carga_masiva") && (
              <CargaMasiva
                products={products}
                currentUser={currentUser}
                onImportComplete={(updated) => setProducts(updated)}
                showToast={showToast}
                activeCatalogId={activeCatalogId}
                catalogos={getAvailableCatalogos()}
                onSelectCatalog={(catId) => {
                  setActiveCatalogId(catId);
                  localStorage.setItem("active_catalog_id", catId);
                }}
              />
            )}

            {activeTab === "historial" && enabledModules.includes("historial") && (
              <HistorialMovimientos
                activeCatalogId={activeCatalogId}
                currentUser={currentUser}
                catalogos={catalogos}
              />
            )}

            {activeTab === "usuarios" && enabledModules.includes("usuarios") && (
              <UserPanel
                users={users}
                departamentos={departamentos}
                currentUser={currentUser}
                onAddUser={handleAddUser}
                onUpdateUser={handleUpdateUser}
                onChangeUserPassword={handleChangeUserPassword}
                onDeleteUser={handleDeleteUser}
                catalogos={catalogos}
              />
            )}

            {activeTab === "solicitudes" && enabledModules.includes("solicitudes") && (
              <SolicitudesPanel
                currentUser={currentUser}
                activePeriod={activePeriod}
                showToast={showToast}
                products={products}
                departamentos={departamentos}
                activeCatalogId={activeCatalogId}
                catalogos={catalogos}
                onSelectCatalog={(catId) => {
                  setActiveCatalogId(catId);
                  localStorage.setItem("active_catalog_id", catId);
                }}
              />
            )}

            {activeTab === "configuracion" && enabledModules.includes("configuracion") && (
              <ConfiguracionPanel
                currentUser={currentUser}
                activePeriod={activePeriod}
                colores={colores}
                onUpdatePeriod={(p) => setActivePeriod(p)}
                onUpdateColores={(c) => setColores(c)}
                showToast={showToast}
                departamentos={departamentos}
                catalogos={catalogos}
                conceptos={conceptos}
                onUpdateConceptos={(list) => setConceptos(list)}
                onUpdateInstitucion={(info) => {
                  if (info.nombre) {
                    const nextMeta = {
                      nombre: "Control de Stock",
                      subtitulo: info.nombre
                    };
                    setFarmaciaMeta(nextMeta);
                    localStorage.setItem("active_farmacia_meta", JSON.stringify(nextMeta));
                  }
                }}
                onSwitchFarmacia={(targetId, targetName) => {
                  const cleanTenant = setActiveFarmaciaId(targetId);
                  setActiveFarmaciaIdState(cleanTenant);
                  const nextMeta = {
                    nombre: "Control de Stock",
                    subtitulo: targetName || `Sede: ${cleanTenant}`
                  };
                  setFarmaciaMeta(nextMeta);
                  localStorage.setItem("active_farmacia_meta", JSON.stringify(nextMeta));
                  const updatedUser = { ...currentUser, farmaciaId: cleanTenant };
                  setCurrentUser(updatedUser);
                  localStorage.setItem("current_user", JSON.stringify(updatedUser));
                  setActiveCatalogId("default-cat");
                  setActiveTab("inventory");
                  playSound("positive");
                  showToast(`Has accedido a la sede: ${targetName || cleanTenant}`);
                }}
              />
            )}

            {activeTab === "inventory" && enabledModules.includes("inventory") && (
              <div className="space-y-6">
                <BlockPanel
                  products={products}
                  blocks={blocks}
                  selectedBlock={selectedBlock}
                  blockLevelFilter={blockLevelFilter}
                  blockAddMode={blockAddMode}
                  blockAddProduct={blockAddProduct}
                  blockProductSearch={blockProductSearch}
                  onSelectBlock={handleSelectBlock}
                  onSetBlockLevelFilter={(l) => setBlockLevelFilter(l)}
                  onAddSupplyToBlock={() => setBlockAddMode("selectProduct")}
                  onUpdateBlockProductSearch={setBlockProductSearch}
                  onStartBlockAddProduct={(p) => {
                    setBlockAddProduct(p);
                    setBlockAddMode("selectLevel");
                  }}
                  onCancelBlockAdd={() => {
                    setBlockAddMode(null);
                    setBlockAddProduct(null);
                  }}
                  onBackToBlockProductSelection={() => setBlockAddMode("selectProduct")}
                  onConfirmBlockLevelAssignment={handleAddSupplyToBlockConfirm}
                  onRemoveSupplyFromBlock={handleRemoveSupplyFromBlock}
                  onOpenProductDetail={handleOpenDetails}
                />

                {showOrder && (
                  <OrderPanel
                    products={products}
                    orderItems={orderItems}
                    orderSelectedProduct={orderSelectedProduct}
                    orderSelectedLot={orderSelectedLot}
                    orderSelectedQuantity={orderSelectedQuantity}
                    orderProductSearch={orderProductSearch}
                    onCloseOrderPanel={() => setShowOrder(false)}
                    onClearOrder={() => setOrderItems([])}
                    onCompleteOrder={handleCompleteOrder}
                    onShareOrderByWhatsApp={handleShareWhatsApp}
                    onUpdateOrderItemQuantity={(idx, qty) => {
                      const item = orderItems[idx];
                      if (!item) return;
                      const prod = products.find((p) => p.codigo === item.productCode);
                      const lot = prod?.lotes.find((l) => l.id === item.loteId);
                      if (!prod || !lot) return;
                      if (qty <= 0) {
                        playSound("negative");
                        showToast("La cantidad debe ser mayor que 0.");
                        return;
                      }
                      const stockSistema = Number(lot.cantidad || 0);
                      const stockFisico = Number(lot.cantidadF || 0);
                      const maxAvailableBoth = Math.min(stockSistema, stockFisico);
                      if (qty > stockSistema || qty > stockFisico) {
                        playSound("negative");
                        showToast(
                          `Stock insuficiente en lote ${lot.numeroLote} (${prod.nombre}). Disponible en Sistema: ${stockSistema} und. | Físico: ${stockFisico} und. (Máx: ${maxAvailableBoth} und.)`
                        );
                        return;
                      }
                      setOrderItems((prev) =>
                        prev.map((it, i) => (i === idx ? { ...it, cantidadAprobada: qty } : it))
                      );
                    }}
                    onRemoveOrderItem={(idx) => setOrderItems((prev) => prev.filter((_, i) => i !== idx))}
                    onUpdateOrderProductSearch={setOrderProductSearch}
                    onSelectOrderProduct={handleSelectOrderProduct}
                    onSetOrderSelectedLot={setOrderSelectedLot}
                    onSetOrderSelectedQuantity={setOrderSelectedQuantity}
                    onAddOrderItem={handleAddOrderItem}
                    blocks={blocks}
                    availableCatalogos={getAvailableCatalogos()}
                    orderCatalogId={orderCatalogId}
                    onSetOrderCatalogId={handleSetOrderCatalogId}
                  />
                )}

                {/* Vista del Catálogo de Insumos */}
                {!selectedBlock && !showOrder && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200/90 px-4 sm:px-5 py-3 shadow-2xs flex flex-wrap justify-between items-center gap-3 relative">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-600"></span>
                        <span className="text-xs sm:text-sm text-slate-700 font-extrabold uppercase tracking-wider">
                          Catálogo de Suministros ({getFilteredProducts().length})
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2.5">
                        {catalogFilter === "prioridad" && (
                          <span className="text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1 rounded-xl text-[11px] font-extrabold tracking-normal normal-case">
                            Orden de Prioridad por Vencimiento
                          </span>
                        )}
                        
                        <div className="relative" ref={exportMenuRef}>
                          <button
                            type="button"
                            onClick={() => {
                              setShowExportMenu(!showExportMenu);
                              playSound("click");
                            }}
                            className="inline-flex items-center gap-2 bg-teal-50 border border-teal-300 text-teal-900 hover:bg-teal-100 active:scale-95 transition rounded-xl px-3.5 py-2 text-xs font-extrabold cursor-pointer shadow-2xs uppercase tracking-wider"
                          >
                            <FileDown className="w-4 h-4 text-teal-700" />
                            <span>Exportar</span>
                          </button>
                          
                          {showExportMenu && (
                            <div className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 py-1.5 normal-case tracking-normal text-slate-700 font-bold anim-pop-in">
                              <button
                                type="button"
                                onClick={() => {
                                  handleExport("pdf");
                                  setShowExportMenu(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-teal-700 transition flex items-center gap-2.5 cursor-pointer border-b border-slate-100"
                              >
                                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                                <span>Documento PDF (.pdf)</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleExport("word");
                                  setShowExportMenu(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 hover:text-teal-700 transition flex items-center gap-2.5 cursor-pointer"
                              >
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
                                <span>Microsoft Word (.docx)</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {getFilteredProducts().map((p, idx) => {
                        const stats = getProductStats(p);
                        const coords = getProductCoordinates(p.codigo);
                        const productImage = getProductImages(p)[0];

                        return (
                          <div
                            key={p.codigo}
                            onClick={() => handleOpenDetails(p.codigo)}
                            className="anim-card-in card-tap bg-white rounded-2xl shadow-xs border border-slate-200/90 p-4 sm:p-5 cursor-pointer relative flex flex-col justify-between"
                            style={{ animationDelay: `${Math.min(idx, 15) * 20}ms` }}
                          >
                            <div className="flex flex-col xs:flex-row sm:flex-row justify-between items-start gap-3 sm:gap-4">
                              <div className="flex items-start gap-3 min-w-0 flex-1 w-full">
                                {productImage ? (
                                  <button
                                    type="button"
                                    aria-label={`Ampliar fotografía de ${p.nombre}`}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setZoomProductImage({ url: productImage, alt: p.nombre });
                                    }}
                                    className="h-12 w-12 shrink-0 cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 shadow-2xs sm:h-14 sm:w-14"
                                  >
                                    <img
                                      src={productImage}
                                      alt={p.nombre}
                                      className="h-full w-full object-cover"
                                    />
                                  </button>
                                ) : (
                                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-50 border border-slate-200/90 flex items-center justify-center shrink-0 text-teal-600/70 shadow-2xs">
                                    <Package className="w-5 h-5 sm:w-6 sm:h-6" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <span className="inline-block font-mono text-[11px] font-extrabold text-teal-800 bg-teal-50 border border-teal-200/80 px-2 py-0.5 rounded-md tracking-wider uppercase mb-1">
                                    {p.codigo}
                                  </span>
                                  <MarqueeText
                                    text={p.nombre}
                                    className="w-full"
                                    textClassName="font-extrabold text-slate-900 text-sm sm:text-base leading-snug"
                                  />
                                  <p className="text-xs text-slate-500 mt-1 line-clamp-1 font-medium">
                                    {p.descripcion || "Sin descripción adicional"}
                                  </p>
                                  {coords !== "No asignado" && (
                                    <div className="inline-flex items-center gap-1.5 mt-2 text-[11px] font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-lg uppercase tracking-wider">
                                      <MapPin className="w-3.5 h-3.5 text-teal-600" />
                                      <span>{coords}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 self-end xs:self-start sm:self-start">
                                <div className="text-center bg-slate-50 border border-slate-200/90 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 min-w-[58px] sm:min-w-[64px]">
                                  <p className="text-base sm:text-lg font-black text-slate-900 leading-none tabular-nums">{stats.totalStock}</p>
                                  <span className="block text-[9px] text-slate-500 font-extrabold uppercase tracking-wider mt-1">
                                    Sistema
                                  </span>
                                </div>
                                <div className="text-center bg-amber-50/60 border border-amber-200/80 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 min-w-[58px] sm:min-w-[64px]">
                                  <p className="text-base sm:text-lg font-black text-amber-900 leading-none tabular-nums">{stats.physicalStock}</p>
                                  <span className="block text-[9px] text-amber-700 font-extrabold uppercase tracking-wider mt-1">
                                    Físico
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-3.5 border-t border-slate-100">
                              <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-slate-100 text-slate-700 border border-slate-200/80 tabular-nums">
                                <Layers className="w-3.5 h-3.5 text-slate-500" />
                                {p.lotes.length} {p.lotes.length === 1 ? "lote" : "lotes"}
                              </span>

                              <button
                                type="button"
                                onClick={(e) => handleToggleVerification(e, p.codigo)}
                                className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl transition cursor-pointer ${
                                  p.verificado
                                    ? "bg-emerald-600 text-white shadow-2xs"
                                    : "bg-slate-50 text-slate-600 border border-dashed border-slate-300 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/40"
                                }`}
                              >
                                {p.verificado ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Verificado</span>
                                  </>
                                ) : (
                                  <>
                                    <X className="w-3.5 h-3.5" />
                                    <span>Verificar</span>
                                  </>
                                )}
                              </button>

                              {stats.hasExpired && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
                                  <TriangleAlert className="w-3.5 h-3.5" />
                                  <span>Vencido</span>
                                </span>
                              )}

                              {stats.hasSoonToExpire && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Por vencer (≤30d)</span>
                                </span>
                              )}

                              {stats.hasNextToExpire && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-yellow-50 text-yellow-800 border border-yellow-300">
                                  <Clock className="w-3.5 h-3.5 text-yellow-600" />
                                  <span>Próx. a vencer (≤90d)</span>
                                </span>
                              )}

                              {stats.lowStock && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-orange-50 text-orange-700 border border-orange-200">
                                  <TrendingDown className="w-3.5 h-3.5" />
                                  <span>Stock Bajo</span>
                                </span>
                              )}

                              {stats.wideMismatch && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>Diferencia</span>
                                </span>
                              )}

                              {stats.hasAdjusted && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Ajustado</span>
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>

          {/* Floating Register Button */}
          {activeTab === "inventory" && !selectedBlock && !showOrder && enabledModules.includes("inventory") && (
            <button
              onClick={() => {
                setShowProductAdd(true);
                playSound("open");
              }}
              className="fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-30 bg-teal-700 hover:bg-teal-600 active:scale-95 transition text-white rounded-2xl shadow-xl shadow-teal-950/25 border border-white/15 px-4 py-3.5 sm:px-6 sm:py-4 flex items-center gap-2 font-extrabold uppercase text-[11px] sm:text-xs tracking-wider cursor-pointer bg-custom-buttons"
            >
              <Plus className="w-5 h-5 shrink-0" />
              <span>Registrar Entrada</span>
            </button>
          )}

          {/* Offline Connectivity Indicator */}
          <OfflineIndicator />

          {/* Global Toast Alert */}
          {toastMessage && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[92vw] sm:w-auto max-w-md bg-slate-900 text-white text-xs sm:text-sm font-extrabold px-4 py-3.5 sm:px-5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-2.5 anim-toast">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
              <span className="leading-snug">{toastMessage}</span>
            </div>
          )}

          {/* Modal Detalles / Edición de Producto */}
          {selectedProductCode && (
            <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-xs" onClick={() => setSelectedProductCode(null)}></div>
              <div className="relative w-full sm:max-w-2xl h-[90vh] sm:h-[86vh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                  <button
                    onClick={() => setSelectedProductCode(null)}
                    className="p-2 -ml-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl active:scale-90 transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <span className="font-mono text-xs font-extrabold text-teal-800 bg-teal-50 px-3.5 py-1.5 rounded-xl border border-teal-200 uppercase tracking-wider">
                    Suministro: {selectedProductCode}
                  </span>
                  <button
                    onClick={handleDeleteProduct}
                    className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl active:scale-90 transition cursor-pointer"
                    title="Eliminar suministro"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                  <ProductPhotosEditor images={editImages} onChange={setEditImages} />

                  <div className="bg-white rounded-2xl p-5 border border-slate-200/90 space-y-4 shadow-2xs">
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                        Nombre del Suministro
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full text-sm rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-teal-500/30 font-bold text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                        Descripción o Presentación
                      </label>
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full text-sm rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-teal-500/30 font-medium text-slate-800"
                      />
                    </div>
                  </div>

                  {/* Lotes de este medicamento */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                        Lotes Registrados ({editLotes.length})
                      </h3>
                      <button
                        onClick={() => {
                          setShowLotAdd(true);
                          playSound("open");
                        }}
                        className="flex items-center gap-1.5 text-xs font-extrabold text-teal-800 bg-teal-50 hover:bg-teal-100 px-3.5 py-2 rounded-xl active:scale-95 transition border border-teal-200 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Agregar Lote</span>
                      </button>
                    </div>

                    <div className="space-y-4">
                      {editLotes.map((l) => {
                        const daysTo = getDaysToExpiration(l.fechaVencimiento);
                        const hasStock = Number(l.cantidad || 0) > 0;
                        const status = !hasStock ? "sinStock" : daysTo < 0 ? "vencido" : daysTo <= 30 ? "proximo" : (daysTo <= 90 ? "pronto" : "ok");

                        let cardBgClass = "bg-white border-slate-200/90";
                        if (status === "vencido") {
                          cardBgClass = "bg-rose-50/70 border-rose-200";
                        } else if (status === "proximo") {
                          cardBgClass = "bg-amber-50/70 border-amber-200";
                        } else if (status === "pronto") {
                          cardBgClass = "bg-yellow-50/50 border-yellow-200";
                        }

                        return (
                          <div
                            key={l.id}
                            className={`rounded-2xl border p-4 sm:p-5 space-y-4 shadow-2xs transition-all ${cardBgClass}`}
                          >
                            <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:items-center pb-3 border-b border-slate-200/70">
                              <span className="font-mono text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                                N.º Lote: {l.numeroLote}
                              </span>
                              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                                {status === "vencido" && (
                                  <span className="text-[11px] font-extrabold text-rose-700 bg-rose-100 px-2.5 py-1 rounded-lg border border-rose-200">
                                    Vencido ({Math.abs(daysTo)} días atrás)
                                  </span>
                                )}
                                {status === "proximo" && (
                                  <span className="text-[11px] font-extrabold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-lg border border-amber-300 animate-pulse">
                                    Por vencer (en {daysTo} días)
                                  </span>
                                )}
                                {status === "pronto" && (
                                  <span className="text-[11px] font-extrabold text-yellow-800 bg-yellow-100 px-2.5 py-1 rounded-lg border border-yellow-300">
                                    Vence pronto (en {daysTo} días)
                                  </span>
                                )}
                                {status === "ok" && (
                                  <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                                    Vigente ({daysTo} días rest.)
                                  </span>
                                )}
                                {status === "sinStock" && (
                                  <span className="text-[11px] font-extrabold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                                    Sin existencias
                                  </span>
                                )}
                                {l.articuloAjustado && (
                                  <span className="text-[11px] font-extrabold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-lg border border-amber-200">
                                    Ajustado
                                  </span>
                                )}

                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!coincidenLotesMap[l.id]}
                                    onChange={(e) => handleToggleCoincide(l.id, e.target.checked)}
                                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                                  />
                                  <span>Coincide</span>
                                </label>

                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!l.articuloAjustado}
                                    disabled={adjustingLotIds.includes(l.id)}
                                    onChange={(e) => void handleToggleAdjusted(l.id, e.target.checked)}
                                    className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                                  />
                                  <span className="text-amber-800 font-extrabold">Ajustado</span>
                                  {adjustingLotIds.includes(l.id) && <span className="text-[10px] text-slate-500">Guardando…</span>}
                                </label>

                                <button
                                  onClick={() => handleDeleteLot(l.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 active:scale-95 transition cursor-pointer"
                                  title="Eliminar lote"
                                >
                                  <Trash2 className="w-4.5 h-4.5" />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                              <div>
                                <label className="block text-[11px] font-extrabold text-slate-600 uppercase mb-1">
                                  Lote (Sistema)
                                </label>
                                <input
                                  type="text"
                                  value={l.numeroLote}
                                  onChange={(e) => handleEditLotField(l.id, "numeroLote", e.target.value)}
                                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono font-bold text-slate-900 bg-white"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-extrabold text-amber-700 uppercase flex items-center gap-1 mb-1">
                                  <MapPin className="w-3.5 h-3.5" /> Lote F (Físico)
                                </label>
                                <input
                                  type="text"
                                  value={l.loteFisico || ""}
                                  disabled={!!coincidenLotesMap[l.id]}
                                  onChange={(e) => handleEditLotField(l.id, "loteFisico", e.target.value)}
                                  placeholder="Ej. Estante B"
                                  className="w-full rounded-xl border border-amber-300 bg-amber-50/50 disabled:bg-slate-100 disabled:border-slate-200 px-3 py-2 font-bold text-slate-900"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-extrabold text-slate-600 uppercase mb-1">
                                  Cantidad (Sistema)
                                </label>
                                <input
                                  type="number"
                                  value={l.cantidad}
                                  onChange={(e) => handleEditLotField(l.id, "cantidad", Number(e.target.value))}
                                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold text-slate-900 bg-white tabular-nums"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-extrabold text-amber-700 uppercase flex items-center gap-1 mb-1">
                                  <MapPin className="w-3.5 h-3.5" /> Cantidad F (Física)
                                </label>
                                <input
                                  type="number"
                                  value={l.cantidadF || 0}
                                  disabled={!!coincidenLotesMap[l.id]}
                                  onChange={(e) => handleEditLotField(l.id, "cantidadF", Number(e.target.value))}
                                  className="w-full rounded-xl border border-amber-300 bg-amber-50/50 disabled:bg-slate-100 disabled:border-slate-200 px-3 py-2 font-bold text-slate-900 tabular-nums"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-extrabold text-slate-600 uppercase mb-1">
                                  Vencimiento (Sistema)
                                </label>
                                <input
                                  type="date"
                                  value={l.fechaVencimiento}
                                  onChange={(e) => handleEditLotField(l.id, "fechaVencimiento", e.target.value)}
                                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold text-slate-900 bg-white text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-extrabold text-amber-700 uppercase flex items-center gap-1 mb-1">
                                  <MapPin className="w-3.5 h-3.5" /> Vencimiento F (Física)
                                </label>
                                <input
                                  type="date"
                                  value={l.fechaFisica || ""}
                                  disabled={!!coincidenLotesMap[l.id]}
                                  onChange={(e) => handleEditLotField(l.id, "fechaFisica", e.target.value)}
                                  className="w-full rounded-xl border border-amber-300 bg-amber-50/50 disabled:bg-slate-100 disabled:border-slate-200 px-3 py-2 font-bold text-slate-900 text-xs"
                                />
                              </div>

                              <div className="sm:col-span-2">
                                <label className="block text-[11px] font-extrabold text-slate-600 uppercase mb-1">
                                  Costo Adquisición Unitario (RD$)
                                </label>
                                <input
                                  type="number"
                                  value={l.precio}
                                  onChange={(e) => handleEditLotField(l.id, "precio", Number(e.target.value))}
                                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold text-slate-900 bg-white tabular-nums"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 bg-white shrink-0">
                  <button
                    onClick={handleSaveDetails}
                    className="w-full bg-teal-700 hover:bg-teal-600 active:scale-95 transition text-white font-extrabold text-sm rounded-xl py-3.5 uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    Guardar Cambios
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Añadir Lote */}
          {showLotAdd && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-xs" onClick={() => setShowLotAdd(false)}></div>
              <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in max-h-[88vh]">
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-200 shrink-0 bg-slate-50">
                  <h2 className="font-extrabold text-slate-900 text-base">Agregar Nuevo Lote</h2>
                  <button
                    onClick={() => setShowLotAdd(false)}
                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                      Lote (Sistema) *
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. AB-202"
                      value={newLotNum}
                      onChange={(e) => setNewLotNum(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                        Cantidad (Sistema) *
                      </label>
                      <input
                        type="number"
                        min="1"
                        placeholder="0"
                        value={newLotQty}
                        onChange={(e) => setNewLotQty(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-extrabold text-amber-700 uppercase tracking-wider mb-1.5">
                        Cantidad F (Física)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="Vacío = igualar"
                        value={newLotQtyF}
                        onChange={(e) => setNewLotQtyF(e.target.value)}
                        className="w-full rounded-xl border border-amber-300 bg-amber-50/50 px-3.5 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400 tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                        Vencimiento (Sistema) *
                      </label>
                      <input
                        type="date"
                        value={newLotExpDate}
                        onChange={(e) => setNewLotExpDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-extrabold text-amber-700 uppercase tracking-wider mb-1.5">
                        Vencimiento F (Física)
                      </label>
                      <input
                        type="date"
                        value={newLotPhysExpDate}
                        onChange={(e) => setNewLotPhysExpDate(e.target.value)}
                        className="w-full rounded-xl border border-amber-300 bg-amber-50/50 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-amber-700 uppercase tracking-wider mb-1.5">
                      Lote F (Físico) / Ubicación
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Estante B"
                      value={newLotLocation}
                      onChange={(e) => setNewLotLocation(e.target.value)}
                      className="w-full rounded-xl border border-amber-300 bg-amber-50/50 px-3.5 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                      Costo Adquisición (RD$) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={newLotPrice}
                      onChange={(e) => setNewLotPrice(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white tabular-nums"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
                  <button
                    onClick={handleAddLot}
                    className="w-full bg-teal-700 hover:bg-teal-600 text-white font-extrabold text-xs py-3.5 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer"
                  >
                    Añadir Lote
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Registro de Entrada de Productos (Diseño Exacto Imagen 3) */}
          {showProductAdd && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-xs" onClick={() => setShowProductAdd(false)}></div>
              <div className="relative w-full sm:max-w-3xl bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in max-h-[92vh] border border-slate-200">
                {/* Cabecera del Modal (Imagen 3) */}
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-200 bg-white shrink-0">
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-extrabold text-slate-900 text-base uppercase tracking-wide leading-tight">
                        REGISTRO DE ENTRADA DE PRODUCTOS
                      </h2>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">
                        Agrega los productos a la lista temporal de la factura y confirma la entrada en un solo paso
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowProductAdd(false)}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Cuerpo con Scroll */}
                <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5 bg-slate-50">
                  {/* SECCIÓN 1: INFORMACIÓN DE LA FACTURA / COMPROBANTE */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-3">
                      <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-teal-800">
                        <FileText className="w-4 h-4 text-teal-600" />
                        <span>1. INFORMACIÓN DE LA FACTURA / COMPROBANTE</span>
                      </h3>
                      <span className="text-[11px] font-semibold text-slate-500">
                        Los productos registrados quedarán agrupados bajo esta factura
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          N.º DE FACTURA *
                        </label>
                        <input
                          type="text"
                          placeholder="EJ. F100094"
                          value={invoiceNum}
                          onChange={(e) => setInvoiceNum(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-mono font-bold uppercase text-slate-900 bg-white outline-none focus:ring-2 focus:ring-teal-500/30 transition"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          FECHA DE ENTRADA *
                        </label>
                        <input
                          type="date"
                          value={invoiceDate}
                          onChange={(e) => setInvoiceDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-bold text-slate-900 bg-white outline-none focus:ring-2 focus:ring-teal-500/30 transition"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          PROVEEDOR / OBSERVACIÓN (OPCIONAL)
                        </label>
                        <input
                          type="text"
                          placeholder="Ej. Laboratorio Central / Compra"
                          value={invoiceSupplier}
                          onChange={(e) => setInvoiceSupplier(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-semibold text-slate-900 bg-white outline-none focus:ring-2 focus:ring-teal-500/30 transition"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SECCIÓN 2: CARGAR PRODUCTO A LA ENTRADA */}
                  <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-3">
                      <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800">
                        <Package className="w-4 h-4 text-teal-600" />
                        <span>2. CARGAR PRODUCTO A LA ENTRADA</span>
                      </h3>
                      <span className="text-[11px] font-semibold text-slate-500">
                        Completa los datos y presiona "+ Añadir a la Lista"
                      </span>
                    </div>

                    {/* Fila 1: Código + Nombre del Medicamento */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          CÓDIGO (OPCIONAL)
                        </label>
                        <input
                          type="text"
                          placeholder="AUTO O EJ. A100"
                          value={newProdCode}
                          onChange={(e) => {
                            const code = e.target.value;
                            const matchingProduct = products.find((product) =>
                              product.codigo === code.trim().toUpperCase() &&
                              matchesCatalog(product.catalogId, activeCatalogId, catalogos)
                            );
                            setNewProdCode(code);
                            setNewProdPhotos(matchingProduct ? getProductImages(matchingProduct) : []);
                            setNewProdPhotoProductCode(matchingProduct?.codigo || null);
                          }}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs outline-none focus:ring-2 focus:ring-teal-500/30 bg-white font-mono font-bold uppercase text-slate-900"
                        />
                      </div>

                      <div ref={nameSuggestionsRef} className="sm:col-span-2 relative">
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          NOMBRE DEL MEDICAMENTO / INSUMO *
                        </label>
                        <input
                          type="text"
                          placeholder="Ej. Amoxicilina 500mg cápsulas"
                          value={newProdName}
                          onChange={(e) => {
                            setNewProdName(e.target.value);
                            setShowNameSuggestions(true);
                          }}
                          onFocus={() => setShowNameSuggestions(true)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white text-slate-900"
                        />
                        {showNameSuggestions && newProdName.trim().length > 0 && (() => {
                          const filteredSuggestions = products.filter(
                            (p) =>
                              (p.catalogId || "default-cat") === activeCatalogId &&
                              p.nombre.toLowerCase().includes(newProdName.toLowerCase())
                          );
                          if (filteredSuggestions.length === 0) return null;

                          return (
                            <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-52 overflow-y-auto">
                              {filteredSuggestions.map((prod) => (
                                <button
                                  key={prod.codigo}
                                  type="button"
                                  onClick={() => {
                                    setNewProdName(prod.nombre);
                                    setNewProdDesc(prod.descripcion || "");
                                    setNewProdCode(prod.codigo);
                                    setNewProdPhotos(getProductImages(prod));
                                    setNewProdPhotoProductCode(prod.codigo);
                                    setShowNameSuggestions(false);
                                    playSound("click");
                                  }}
                                  className="w-full text-left px-4 py-2.5 text-xs hover:bg-teal-50 hover:text-teal-800 transition font-bold border-b border-slate-100 last:border-0 flex justify-between items-center cursor-pointer"
                                >
                                  <span>{prod.nombre}</span>
                                  <span className="text-[11px] text-teal-700 font-mono bg-teal-50 px-2 py-0.5 rounded">{prod.codigo}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Fila 2: Descripción o Presentación */}
                    <div>
                      <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                        DESCRIPCIÓN O PRESENTACIÓN
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Caja por 100 cápsulas / Frasco 60ml"
                        value={newProdDesc}
                        onChange={(e) => setNewProdDesc(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white text-slate-900"
                      />
                    </div>

                    {/* Fila 3: Lote (Sistema) + Lote F / Ubicación Física */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          LOTE (SISTEMA) *
                        </label>
                        <input
                          type="text"
                          placeholder="EJ. LOT-8942"
                          value={newProdLotNum}
                          onChange={(e) => setNewProdLotNum(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-mono font-bold uppercase outline-none focus:ring-2 focus:ring-teal-500/30 bg-white text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-amber-700 uppercase tracking-wider mb-1.5">
                          LOTE F / UBICACIÓN FÍSICA
                        </label>
                        <input
                          type="text"
                          placeholder="EJ. ESTANTE A-2"
                          value={newProdLotLocation}
                          onChange={(e) => setNewProdLotLocation(e.target.value)}
                          className="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3.5 py-2.5 text-xs font-bold uppercase outline-none focus:ring-2 focus:ring-amber-400 text-slate-900"
                        />
                      </div>
                    </div>

                    {/* Fila 4: Cantidad (Sistema) + Cantidad F (Física) + Costo Adquisición Unit. (RD$) */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          CANTIDAD (SISTEMA) *
                        </label>
                        <input
                          type="number"
                          min="1"
                          placeholder="Ej. 10"
                          value={newProdLotQty}
                          onChange={(e) => setNewProdLotQty(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white text-slate-900 tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-amber-700 uppercase tracking-wider mb-1.5">
                          CANTIDAD F (FÍSICA)
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Dejar vacío para igualar"
                          value={newProdLotQtyF}
                          onChange={(e) => setNewProdLotQtyF(e.target.value)}
                          className="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400 text-slate-900 tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          COSTO ADQUISICIÓN UNIT. (RD$) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={newProdLotPrice}
                          onChange={(e) => setNewProdLotPrice(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white text-slate-900 tabular-nums"
                        />
                      </div>
                    </div>

                    {/* Fila 5: Fecha Vencimiento (Sistema) + Fecha Vencimiento F (Física) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mb-1.5">
                          FECHA VENCIMIENTO (SISTEMA) *
                        </label>
                        <input
                          type="date"
                          value={newProdLotExpDate}
                          onChange={(e) => setNewProdLotExpDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/30 bg-white text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-extrabold text-amber-700 uppercase tracking-wider mb-1.5">
                          FECHA VENCIMIENTO F (FÍSICA)
                        </label>
                        <input
                          type="date"
                          value={newProdLotPhysExpDate}
                          onChange={(e) => setNewProdLotPhysExpDate(e.target.value)}
                          className="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3.5 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400 text-slate-900"
                        />
                      </div>
                    </div>

                    {/* Fila 6: Fotografías del Producto (Opcional) */}
                    <div className="pt-1">
                      <ProductPhotosEditor images={newProdPhotos} onChange={setNewProdPhotos} />
                    </div>
                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddPendingEntryItem}
                        className="px-5 py-3 bg-teal-900 hover:bg-teal-800 active:scale-95 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition flex items-center gap-2 shadow-sm cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>+ AÑADIR A LA LISTA DE ENTRADA</span>
                      </button>
                    </div>
                  </div>

                  {/* SECCIÓN 3: PRODUCTOS PENDIENTES DE ENTRADA */}
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-800 px-1">
                      <Layers className="w-4 h-4 text-teal-600" />
                      <span>3. PRODUCTOS PENDIENTES DE ENTRADA ({pendingEntryItems.length})</span>
                    </h3>

                    {pendingEntryItems.length === 0 ? (
                      <div className="bg-white rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center space-y-2">
                        <Package className="w-9 h-9 text-slate-400 mx-auto stroke-[1.5]" />
                        <p className="text-xs font-extrabold text-slate-700">
                          Aún no has agregado productos a esta entrada
                        </p>
                        <p className="text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
                          Completa los campos del formulario superior y haz clic en "+ Añadir a la Lista de Entrada". Los productos se mantendrán en esta tabla antes de aplicarse a la base de datos.
                        </p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                        <div className="overflow-x-auto">
                          <table className="min-w-[640px] w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold uppercase text-slate-600 tracking-wider">
                                <th className="px-4 py-3">Código</th>
                                <th className="px-4 py-3">Medicamento / Insumo</th>
                                <th className="px-4 py-3">Lote / Ubic.</th>
                                <th className="px-4 py-3 text-right">Cant. (Sis/Fís)</th>
                                <th className="px-4 py-3">Vence</th>
                                <th className="px-4 py-3 text-right">Costo Unit.</th>
                                <th className="px-4 py-3 text-right">Subtotal</th>
                                <th className="px-3 py-3 text-center"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {pendingEntryItems.map((it) => {
                                const sub = it.cantidad * it.precio;
                                return (
                                  <tr key={it.tempId} className="hover:bg-slate-50/80">
                                    <td className="px-4 py-3 font-mono font-extrabold text-teal-800">{it.codigo}</td>
                                    <td className="px-4 py-3">
                                      <p className="font-bold text-slate-900">{it.nombre}</p>
                                      {it.descripcion && <p className="text-[10px] text-slate-500">{it.descripcion}</p>}
                                    </td>
                                    <td className="px-4 py-3 font-mono font-bold text-slate-800">
                                      {it.numeroLote}
                                      <span className="block text-[10px] text-amber-700 font-sans">
                                        {it.loteFisico}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                                      {it.cantidad}{" "}
                                      <span className="text-[10px] text-amber-700">({it.cantidadF})</span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700 font-semibold tabular-nums">{it.fechaVencimiento}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-slate-700 tabular-nums">
                                      RD$ {it.precio.toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3 text-right font-extrabold text-teal-800 tabular-nums">
                                      RD$ {sub.toFixed(2)}
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleRemovePendingEntryItem(it.tempId)}
                                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer"
                                        title="Quitar de la lista"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Pie del Modal (Imagen 3: Cerrar + CONFIRMAR ENTRADA (X PRODUCTOS)) */}
                <div className="px-6 py-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowProductAdd(false)}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs transition cursor-pointer"
                  >
                    Cerrar
                  </button>

                  <button
                    type="button"
                    disabled={pendingEntryItems.length === 0 || confirmingEntry}
                    onClick={handleAddProductSubmit}
                    className={`w-full sm:w-auto px-7 py-3.5 rounded-xl font-extrabold text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 ${
                      pendingEntryItems.length === 0 || confirmingEntry
                        ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                        : "bg-teal-700 hover:bg-teal-800 text-white shadow-sm active:scale-95 cursor-pointer"
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {confirmingEntry
                        ? "CONFIRMANDO ENTRADA..."
                        : `CONFIRMAR ENTRADA (${pendingEntryItems.length} PRODUCTOS)`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          <ImageLightbox
            imageUrl={zoomProductImage?.url || null}
            alt={zoomProductImage?.alt || "Fotografía del producto"}
            onClose={() => setZoomProductImage(null)}
          />

          {/* Global Lateral Chat drawer */}
          {!showProductAdd && <ChatLateral currentUser={currentUser} />}
        </div>
      )}
    </>
  );
}
