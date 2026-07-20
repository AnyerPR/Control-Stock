import React, { useState, useEffect, useRef } from "react";
import { collection, doc, query, onSnapshot, getDocs, getDoc, writeBatch, updateDoc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "./firebase";
import { Producto, Usuario, Lote, Movimiento, ColoresConfig, Departamento, getEnabledModules } from "./types";
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
import ChatLateral from "./components/ChatLateral";
import { logSystemEvent } from "./utils/chatHelper";

// Suministros predefinidos para autosembrado (si la base de datos está vacía)
import { bH as DEFAULT_PRODUCTS } from "./defaultProducts";

// Iconos de Lucide
import {
  Layers,
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
  AlertCircle
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
  sinVerificar: "Sin verificar"
};

const BLOQUES = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

export default function App() {
  const [products, setProducts] = useState<Producto[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [users, setUsers] = useState<Usuario[]>([]);
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [catalogos, setCatalogos] = useState<any[]>([]);
  const [activeCatalogId, setActiveCatalogId] = useState<string>("default-cat");
  const [currentUser, setCurrentUser] = useState<Usuario | null>(() => {
    const saved = localStorage.getItem("current_user");
    if (saved) {
      try { return JSON.parse(saved); } catch { return null; }
    }
    return null;
  });

  const [activeTab, setActiveTab] = useState<string>("inventory");
  const [catalogFilter, setCatalogFilter] = useState("todos");
  const [searchQuery, setSearchTerm] = useState("");
  const [showUnverifiedOnly, setShowUnverifiedOnly] = useState(false);

  // Edit / Details Modal State
  const [selectedProductCode, setSelectedProductCode] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLotes, setEditLotes] = useState<Lote[]>([]);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
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

  // Product Create Form
  const [showProductAdd, setShowProductAdd] = useState(false);
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

  // Auto-redirect to first enabled module upon login, if current tab is not enabled
  useEffect(() => {
    if (currentUser) {
      const enabled = getEnabledModules(currentUser);
      if (enabled.length > 0) {
        if (!enabled.includes(activeTab)) {
          setActiveTab(enabled[0]);
        }
      }
    }
  }, [currentUser]);

  // Keep currentUser state in sync with users list from DB
  useEffect(() => {
    if (currentUser && users.length > 0) {
      const dbUser = users.find((u) => u.id === currentUser.id);
      if (dbUser) {
        const dbModulos = dbUser.modulos || [];
        const currentModulos = currentUser.modulos || [];
        const modulosChanged = JSON.stringify(dbModulos) !== JSON.stringify(currentModulos);
        if (
          dbUser.nombre !== currentUser.nombre ||
          dbUser.rol !== currentUser.rol ||
          dbUser.estado !== currentUser.estado ||
          dbUser.departamento !== currentUser.departamento ||
          modulosChanged
        ) {
          setCurrentUser(dbUser);
          localStorage.setItem("current_user", JSON.stringify(dbUser));
        }
      }
    }
  }, [users, currentUser]);

  // Catalog Auto-Migration
  useEffect(() => {
    const runCatalogMigration = async () => {
      try {
        const migrationRef = doc(db, "configuracion", "migracion_catalogos_v2");
        const migrationSnap = await getDoc(migrationRef);
        
        // If already run, do nothing
        if (migrationSnap.exists() && migrationSnap.data()?.completada) {
          console.log("Migration already completed in a previous session.");
          return;
        }

        console.log("Starting catalog migration to 'Medicamentos e Insumos'...");

        // 1. Ensure the default catalog "Medicamentos e Insumos" exists and has ID "default-cat"
        const defaultCatRef = doc(db, "catalogos", "default-cat");
        await setDoc(defaultCatRef, {
          id: "default-cat",
          nombre: "Medicamentos e Insumos",
          descripcion: "Catálogo de Medicamentos e Insumos",
          activo: true,
          createdAt: Date.now()
        }, { merge: true });

        // Ensure "laboratorio" exists
        const labRef = doc(db, "catalogos", "laboratorio");
        await setDoc(labRef, {
          id: "laboratorio",
          nombre: "Laboratorio",
          descripcion: "Catálogo de Laboratorio",
          activo: true,
          createdAt: Date.now()
        }, { merge: true });

        // Ensure "odontologia" exists
        const odRef = doc(db, "catalogos", "odontologia");
        await setDoc(odRef, {
          id: "odontologia",
          nombre: "Odontología",
          descripcion: "Catálogo de Odontología",
          activo: true,
          createdAt: Date.now()
        }, { merge: true });

        // Helper to update collection documents that are missing catalogId
        const migrateCollection = async (collectionName: string) => {
          const colRef = collection(db, collectionName);
          const snapshot = await getDocs(colRef);
          let count = 0;
          
          let batch = writeBatch(db);
          let batchCount = 0;

          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            if (!data.catalogId) {
              const docRef = doc(db, collectionName, docSnap.id);
              batch.update(docRef, { catalogId: "default-cat" });
              batchCount++;
              count++;

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

          console.log(`Migrated ${count} documents in ${collectionName}`);
        };

        // Migrate all relevant collections
        await migrateCollection("productos");
        await migrateCollection("movimientos");
        await migrateCollection("solicitudes");
        await migrateCollection("historial");

        // Mark migration as completed
        await setDoc(migrationRef, {
          completada: true,
          timestamp: Date.now(),
          migratedCollections: ["productos", "movimientos", "solicitudes", "historial"]
        });

        console.log("Catalog migration completed successfully!");
      } catch (err) {
        console.error("Error running catalog migration:", err);
      }
    };

    runCatalogMigration();
  }, []);

  // Real-time synchronization
  useEffect(() => {
    setLoading(true);

    // 1. Sync configuration (Colores & Periodo)
    const unsubColores = onSnapshot(doc(db, "configuracion", "colores"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().colores) {
        setColores(docSnap.data().colores);
      }
    });

    const unsubPeriodo = onSnapshot(doc(db, "configuracion", "periodo"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().periodoActual) {
        setActivePeriod(docSnap.data().periodoActual);
      }
    });

    // 2. Sync Products
    const unsubProducts = onSnapshot(collection(db, "productos"), async (snapshot) => {
      if (snapshot.empty) {
        // Seeding database if empty
        try {
          const batch = writeBatch(db);
          const colRef = collection(db, "productos");
          DEFAULT_PRODUCTS.forEach((p) => {
            const docRef = doc(colRef, p.codigo.replace(/\//g, "_"));
            batch.set(docRef, { ...p, updatedAt: Date.now() });
          });
          await batch.commit();
        } catch (err) {
          console.error("Error seeding products database:", err);
        }
      } else {
        const list: Producto[] = [];
        snapshot.forEach((d) => {
          list.push(d.data() as Producto);
        });
        setProducts(list);
        setLoading(false);
      }
    });

    // 3. Sync Blocks
    const unsubBlocks = onSnapshot(collection(db, "bloques"), async (snapshot) => {
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
          const colRef = collection(db, "bloques");
          missing.forEach((id) => {
            batch.set(doc(colRef, id), { id, items: [], updatedAt: Date.now() });
          });
          await batch.commit();
        } catch (err) {
          console.error("Error seeding empty blocks:", err);
        }
      }
      setBlocks(fullBlocks);
    });

    // 4. Sync Users
    const unsubUsers = onSnapshot(collection(db, "usuarios"), async (snapshot) => {
      const list: Usuario[] = [];
      const batchUpdates: Promise<void>[] = [];

      snapshot.forEach((d) => {
        const u = d.data() as Usuario;
        if (!u.departamento) {
          u.departamento = "Almacén y Suministro";
          batchUpdates.push(setDoc(doc(db, "usuarios", d.id), { departamento: "Almacén y Suministro" }, { merge: true }));
        }
        list.push(u);
      });

      if (batchUpdates.length > 0) {
        Promise.all(batchUpdates).catch((err) => console.error("Error updating existing users department:", err));
      }

      // Auto-create default users if empty
      const defaultUsers = [
        { nombre: "Anyer", usuario: "Anyer", pass: "303005", rol: "Administrador" as const },
        { nombre: "Francisco", usuario: "Francisco", pass: "14147", rol: "Administrador" as const },
        { nombre: "Ivelyn", usuario: "Ivelyn", pass: "6606", rol: "Administrador" as const }
      ];

      let seeded = false;
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
              departamento: "Almacén y Suministro"
            };
            await setDoc(doc(db, "usuarios", newUser.id), newUser);
            list.push(newUser);
            seeded = true;
          } catch (err) {
            console.error("Error seeding default users:", err);
          }
        }
      }

      setUsers(list);
    });

    // 5. Sync Departments
    const unsubDepts = onSnapshot(collection(db, "departamentos"), async (snapshot) => {
      if (snapshot.empty) {
        try {
          const batch = writeBatch(db);
          const colRef = collection(db, "departamentos");
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
    });

    // 6. Sync Catalogos
    const unsubCatalogos = onSnapshot(collection(db, "catalogos"), (snapshot) => {
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
        const stored = localStorage.getItem("active_catalog_id");
        const activeItem = list.find((c) => c.activo);
        const storedExistsAndActive = list.find((c) => c.id === stored && c.activo);
        if (storedExistsAndActive) {
          setActiveCatalogId(stored!);
        } else if (activeItem) {
          setActiveCatalogId(activeItem.id);
          localStorage.setItem("active_catalog_id", activeItem.id);
        } else {
          setActiveCatalogId(list[0].id);
          localStorage.setItem("active_catalog_id", list[0].id);
        }
      } else {
        // Seed default catalog if empty
        const defaultCatRef = doc(db, "catalogos", "default-cat");
        setDoc(defaultCatRef, {
          id: "default-cat",
          nombre: "Medicamentos e Insumos",
          descripcion: "Catálogo por defecto del sistema de stock",
          activo: true,
          createdAt: Date.now()
        }).catch(err => console.error("Error seeding default catalog:", err));
      }
    });

    return () => {
      unsubColores();
      unsubPeriodo();
      unsubProducts();
      unsubBlocks();
      unsubUsers();
      unsubDepts();
      unsubCatalogos();
    };
  }, [activePeriod]);

  // Synchronize active catalog when currentUser or catalogos changes
  useEffect(() => {
    if (currentUser && catalogos.length > 0) {
      const allowed = getAvailableCatalogos();
      const isAllowed = allowed.some((c) => c.id === activeCatalogId);
      if (!isAllowed && allowed.length > 0) {
        setActiveCatalogId(allowed[0].id);
        localStorage.setItem("active_catalog_id", allowed[0].id);
      }
    }
  }, [currentUser, catalogos, activeCatalogId]);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Get details and lots status for a product
  const getProductStats = (p: Producto) => {
    const totalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidad || 0), 0);
    const physicalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidadF || 0), 0);
    const hasExpired = p.lotes.some((l) => getDaysToExpiration(l.fechaVencimiento) < 0);
    const hasSoonToExpire = p.lotes.some((l) => {
      const days = getDaysToExpiration(l.fechaVencimiento);
      return days >= 0 && days <= 30;
    });
    const hasNextToExpire = p.lotes.some((l) => {
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
      if (!l.fechaVencimiento) return;
      const t = new Date(l.fechaVencimiento + "T00:00:00").getTime();
      if (!isNaN(t) && t < earliest) earliest = t;
    });
    return earliest;
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      setMuteState(next);
      return next;
    });
  };

  const getAvailableCatalogos = () => {
    const activeCatalogos = catalogos.filter((c) => c.activo);
    if (currentUser?.rol === "Administrador" || currentUser?.departamento === "Almacén y Suministro") {
      return activeCatalogos;
    }
    if (currentUser?.departamento === "Laboratorio") {
      return activeCatalogos.filter((c) => c.id === "laboratorio");
    }
    if (currentUser?.departamento === "Odontología") {
      return activeCatalogos.filter((c) => c.id === "odontologia");
    }
    const userCats = currentUser?.catalogos || [];
    if (userCats.length > 0) {
      return activeCatalogos.filter((c) => userCats.includes(c.id));
    }
    return activeCatalogos;
  };

  // Filter & Search Logic
  const getFilteredProducts = () => {
    const search = searchQuery.trim().toLowerCase();
    
    let filtered = products.filter((p) => {
      // Filter by activeCatalogId
      const pCatalogId = p.catalogId || "default-cat";
      if (pCatalogId !== activeCatalogId) return false;

      // 1. Search Query
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

      // Filter by Unverified if toggled
      if (showUnverifiedOnly && p.verificado) {
        return false;
      }

      // 2. Tab/View selection filters
      if (catalogFilter === "todos") return true;

      const stats = getProductStats(p);
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
        default:
          return true;
      }
    });

    // Handle priority sorting (earliest expiration first)
    if (catalogFilter === "prioridad") {
      filtered = [...filtered].sort((a, b) => {
        const timeA = getEarliestExpiration(a);
        const timeB = getEarliestExpiration(b);
        if (timeA === timeB) return a.nombre.localeCompare(b.nombre);
        return timeA - timeB;
      });
    } else {
      // Sort alphabetically by default
      filtered = [...filtered].sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    return filtered;
  };

  // Product verifications
  const handleToggleVerification = async (e: React.MouseEvent, productCode: string) => {
    e.stopPropagation();
    const prod = products.find((p) => p.codigo === productCode);
    if (!prod) return;

    try {
      const updated = { ...prod, verificado: !prod.verificado, updatedAt: Date.now() };
      await updateDoc(doc(db, "productos", productCode.replace(/\//g, "_")), updated);
      playSound(updated.verificado ? "positive" : "negative");
      showToast(updated.verificado ? "Marcado como verificado" : "Marca de verificado removida");
    } catch (err) {
      console.error(err);
      showToast("Error al guardar estado de verificación");
    }
  };

  // General db save helper for products
  const saveProductDoc = async (prod: Producto) => {
    try {
      const ref = doc(db, "productos", prod.codigo.replace(/\//g, "_"));
      const prodData = {
        ...prod,
        catalogId: prod.catalogId || activeCatalogId,
        verificado: prod.verificado || false,
        updatedAt: Date.now()
      };
      await setDoc(ref, prodData);
    } catch (err) {
      console.error("Error saving product:", err);
      showToast("Error al guardar cambios en la nube");
    }
  };

  // Log single inventory movement
  const saveMovementLog = async (mov: Omit<Movimiento, "id">) => {
    try {
      const id = `mov-${mov.productoCodigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const movData = {
        id,
        catalogId: mov.catalogId || activeCatalogId,
        ...mov
      };
      await setDoc(doc(db, "movimientos", id), movData);
      
      // Post system notification to chat
      logSystemEvent(`📦 **Movimiento de Inventario**: Se registró una **${mov.tipoMovimiento}** del producto **${mov.productoNombre}** (Lote: ${mov.lote}, Cantidad: ${mov.cantidad}) por el usuario ${mov.usuario}.`);
    } catch (err) {
      console.error("Error creating movement log:", err);
    }
  };

  const getProductCoordinates = (productCode: string) => {
    for (const b of blocks) {
      const match = (b.items || []).find((item: any) => item.productCode === productCode);
      if (match) {
        return `Bloque ${b.id} • Nivel ${match.nivel}`;
      }
    }
    return "No asignado";
  };

  const Ni = async (file: File) => {
    const r = new FormData();
    r.append("file", file);
    r.append("upload_preset", "react_cloudinary_stock");
    const res = await fetch("https://api.cloudinary.com/v1_1/du4bco7by/image/upload", {
      method: "POST",
      body: r
    });
    if (!res.ok) throw new Error("Fallo al subir la imagen a la nube.");
    const a = await res.json();
    return a.secure_url as string;
  };

  const handleAddUser = async (data: {
    nombre: string;
    usuario: string;
    passwordText: string;
    rol: "Administrador" | "Operador";
    estado: "Activo" | "Inactivo";
    departamento: string;
    modulos?: string[];
  }) => {
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
        modulos: data.modulos || (data.rol === "Administrador" ? ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"] : ["solicitudes", "historial"])
      };
      await setDoc(doc(db, "usuarios", newUser.id), newUser);
      playSound("positive");
      showToast(`Usuario "${data.usuario}" registrado con éxito.`);
    } catch (err) {
      console.error(err);
      alert("Error al registrar el usuario.");
    }
  };

  const handleUpdateUser = async (id: string, data: Partial<Usuario>) => {
    try {
      await updateDoc(doc(db, "usuarios", id), { ...data, updatedAt: Date.now() });
      playSound("positive");
      showToast("Usuario actualizado con éxito.");
    } catch (err) {
      console.error(err);
      alert("Error al actualizar el usuario.");
    }
  };

  const handleChangeUserPassword = async (id: string, passwordText: string) => {
    try {
      const hash = await hashPassword(passwordText);
      await updateDoc(doc(db, "usuarios", id), { contrasenaHash: hash, updatedAt: Date.now() });
      playSound("positive");
      showToast("Contraseña actualizada con éxito.");
    } catch (err) {
      console.error(err);
      alert("Error al actualizar la contraseña.");
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await deleteDoc(doc(db, "usuarios", id));
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
        batch.delete(doc(db, "productos", selectedProductCode.replace(/\//g, "_")));
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

    const updatedProduct: Producto = {
      ...prod,
      nombre: editName.trim() || prod.nombre,
      descripcion: editDesc.trim(),
      lotes: editLotes
    };

    await saveProductDoc(updatedProduct);

    // Save adjustment logs
    for (const adj of adjustments) {
      await saveMovementLog(adj);
    }

    setSelectedProductCode(null);
    playSound("positive");
    showToast("Los cambios del suministro se han guardado con éxito.");
  };

  // Upload Photo reference to Cloudinary
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProductCode) return;

    setIsPhotoUploading(true);
    playSound("open");

    try {
      const secureUrl = await Ni(file);
      const prod = products.find((p) => p.codigo === selectedProductCode);
      if (prod) {
        const updated = { ...prod, imagen: secureUrl, imagenURL: secureUrl };
        await saveProductDoc(updated);
        showToast("Foto cargada correctamente");
        playSound("positive");
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Error al subir la imagen");
      playSound("negative");
    } finally {
      setIsPhotoUploading(false);
    }
  };

  const handlePhotoDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selectedProductCode) return;

    const prod = products.find((p) => p.codigo === selectedProductCode);
    if (prod && confirm("¿Deseas eliminar la foto de este producto?")) {
      const { imagen, imagenURL, ...cleaned } = prod;
      await saveProductDoc(cleaned as Producto);
      showToast("Foto eliminada correctamente");
      playSound("negative");
    }
  };

  // Create Product Submit
  const handleAddProductSubmit = async () => {
    const code = newProdCode.trim().toUpperCase();
    const name = newProdName.trim();
    const desc = newProdDesc.trim();
    const lotNum = newProdLotNum.trim();
    const qty = Number(newProdLotQty);
    const qtyF = newProdLotQtyF.trim() !== "" ? Number(newProdLotQtyF) : qty;
    const exp = newProdLotExpDate;
    const price = Number(newProdLotPrice);

    if (!code || !name || !lotNum || isNaN(qty) || qty < 0 || !exp || isNaN(price)) {
      alert("Completa todos los campos obligatorios (*) para registrar el producto.");
      return;
    }

    if (products.some((p) => p.codigo === code)) {
      alert(`El código "${code}" ya está registrado en el inventario.`);
      return;
    }

    const newLot: Lote = {
      id: `lote-${code}-${Date.now()}`,
      numeroLote: lotNum,
      cantidad: qty,
      cantidadF: qtyF,
      fechaVencimiento: exp,
      precio: price,
      loteFisico: newProdLotLocation.trim() || "Almacén",
      fechaFisica: newProdLotPhysExpDate || exp
    };

    const newProduct: Producto = {
      codigo: code,
      nombre: name,
      descripcion: desc,
      lotes: [newLot],
      updatedAt: Date.now(),
      catalogId: activeCatalogId
    };

    await saveProductDoc(newProduct);

    // Log movement entry
    const movLog: Omit<Movimiento, "id"> = {
      productoCodigo: code,
      productoNombre: name,
      lote: lotNum,
      cantidad: qty,
      precio: price,
      tipoMovimiento: "Entrada",
      usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema",
      fecha: new Date().toISOString(),
      timestamp: Date.now(),
      catalogId: activeCatalogId
    };
    await saveMovementLog(movLog);

    setShowProductAdd(false);
    // Reset Form
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
    playSound("action");
    showToast(`"${name}" añadido correctamente al inventario.`);
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
    const docRef = doc(db, "bloques", selectedBlock);
    await updateDoc(docRef, { items: updatedItems, updatedAt: Date.now() });

    setBlockAddProduct(null);
    setBlockAddMode(null);
    playSound("positive");
    showToast("Medicamento posicionado en el bloque");
  };

  const handleRemoveSupplyFromBlock = async (itemId: string) => {
    if (!selectedBlock) return;
    const block = blocks.find((b) => b.id === selectedBlock)!;
    const updatedItems = block.items.filter((item: any) => item.id !== itemId);
    
    const docRef = doc(db, "bloques", selectedBlock);
    await updateDoc(docRef, { items: updatedItems, updatedAt: Date.now() });
    playSound("negative");
    showToast("Medicamento removido del bloque");
  };

  // Order List item modifiers
  const handleSetOrderCatalogId = (catId: string) => {
    // Check permissions
    const activeCatalogos = (catalogos || []).filter((c: any) => c.activo);
    const allowedCats = currentUser?.rol === "Administrador"
      ? activeCatalogos
      : activeCatalogos.filter((c: any) => (currentUser?.catalogos || []).includes(c.id));
    
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

    const maxAvailable = Math.max(Number(lot.cantidad || 0), Number(lot.cantidadF || 0));

    if (orderSelectedQuantity <= 0 || orderSelectedQuantity > maxAvailable) {
      alert("La cantidad solicitada supera el stock disponible (sistema y físico) de este lote.");
      return;
    }

    if (orderItems.some((item) => item.productCode === prod.codigo && item.loteId === lot.id)) {
      alert("Este lote ya ha sido añadido al pedido actual.");
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

    // Validate stocks once more before committing
    for (const item of orderItems) {
      const prod = products.find((p) => p.codigo === item.productCode);
      const lot = prod?.lotes.find((l) => l.id === item.loteId);
      const maxAvailable = lot ? Math.max(Number(lot.cantidad || 0), Number(lot.cantidadF || 0)) : 0;
      if (!prod || !lot || maxAvailable < item.cantidadAprobada) {
        alert(`Stock insuficiente en el lote "${item.loteNumero}" para el producto "${item.nombre}".`);
        return;
      }
    }

    try {
      const batch = writeBatch(db);
      const productsCol = collection(db, "productos");
      const movementsCol = collection(db, "movimientos");

      const productsToUpdateMap = new Map<string, Producto>();

      for (const item of orderItems) {
        const prod = productsToUpdateMap.get(item.productCode) || JSON.parse(JSON.stringify(products.find((p) => p.codigo === item.productCode)!));
        
        prod.lotes = prod.lotes.map((l: Lote) => {
          if (l.id === item.loteId) {
            const nextQty = Math.max(0, l.cantidad - item.cantidadAprobada);
            let nextQtyF = l.cantidadF;
            if (l.cantidadF !== undefined && l.cantidadF !== null) {
              nextQtyF = Math.max(0, l.cantidadF - item.cantidadAprobada);
            }
            return { ...l, cantidad: nextQty, cantidadF: nextQtyF };
          }
          return l;
        });

        productsToUpdateMap.set(item.productCode, prod);

        // Create movement log
        const movId = `mov-${prod.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const mov: Movimiento = {
          id: movId,
          productoCodigo: prod.codigo,
          productoNombre: prod.nombre,
          lote: item.loteNumero,
          cantidad: item.cantidadAprobada,
          precio: item.precio,
          tipoMovimiento: "Salida",
          usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema",
          fecha: new Date().toISOString(),
          timestamp: Date.now(),
          catalogId: orderCatalogId || activeCatalogId
        };
        batch.set(doc(movementsCol, movId), mov);
      }

      for (const [code, updatedProd] of productsToUpdateMap.entries()) {
        batch.set(doc(productsCol, code.replace(/\//g, "_")), { ...updatedProd, verificado: false });
      }

      await batch.commit();

      // Download plain TXT file
      downloadOrderFile();
      setOrderItems([]);
      setOrderCatalogId("");
      setShowOrder(false);
      playSound("positive");
      showToast("Pedido completado e inventario actualizado.");
    } catch (err) {
      console.error("Error completing order:", err);
      showToast("Error al completar el pedido");
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
          transition: all 0.2s ease;
        }
        .card-tap:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px -10px rgba(0,0,0,0.08);
        }
        .card-tap:active {
          transform: translateY(1px);
        }
        
        /* Custom scrollbar for chips filter */
        .chip-scroll::-webkit-scrollbar {
          height: 0px;
        }
      `}</style>

      {loading ? (
        <div className="bg-slate-100 text-slate-800 min-h-screen flex flex-col items-center justify-center p-6 font-sans">
          <LoaderCircle className="w-10 h-10 animate-spin text-teal-600 mb-4" />
          <p className="text-sm font-semibold text-slate-600">Conectando con el servidor de seguridad...</p>
        </div>
      ) : !currentUser ? (
        <Login
          users={users}
          isInitializingUsers={loading}
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            localStorage.setItem("current_user", JSON.stringify(user));
            showToast(`¡Bienvenido, ${user.nombre}!`);
            playSound("positive");
          }}
        />
      ) : (
        <div className="bg-slate-100 text-slate-800 min-h-screen pb-24 font-sans selection:bg-teal-500 selection:text-white">
          <header className="sticky top-0 z-30 text-white shadow-md bg-custom-sidebar">
            <div className="px-6 pt-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1
                  className="text-xl font-black leading-tight flex items-center gap-1.5 cursor-pointer"
                  onClick={() => {
                    setActiveTab(currentUser.rol === "Operador" ? "solicitudes" : "inventory");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                  }}
                >
                  Control de Stock
                </h1>
                <p className="text-teal-100 text-xs font-semibold opacity-90">
                  Suministros Hospitalarios • Dr. José Manuel Rodríguez
                </p>
              </div>

              {/* Selector Global de Catálogo */}
              <div className="flex flex-col gap-1 sm:max-w-[240px] w-full sm:mx-4">
                <label className="text-[9px] font-black uppercase text-teal-200 tracking-wider">Catálogo Activo</label>
                <select
                  id="global-catalog-selector"
                  value={activeCatalogId}
                  onChange={(e) => {
                    setActiveCatalogId(e.target.value);
                    localStorage.setItem("active_catalog_id", e.target.value);
                    playSound("action");
                    showToast(`Catálogo: ${catalogos.find(c => c.id === e.target.value)?.nombre || "Cargando..."}`);
                  }}
                  className="bg-teal-950/40 border border-teal-500/30 rounded-xl px-3 py-1.5 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-teal-300 w-full cursor-pointer transition hover:bg-teal-950/50"
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

              <div className="flex items-center gap-3 self-end sm:self-auto">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-black leading-none text-white">{currentUser.nombre}</p>
                  <p className="text-[10px] font-bold text-teal-200 uppercase tracking-wider mt-1">{currentUser.rol}</p>
                </div>

                <button
                  onClick={handleToggleMute}
                  className="p-2.5 bg-white/10 hover:bg-white/20 active:scale-95 transition rounded-xl text-white shadow-sm flex items-center justify-center cursor-pointer"
                  title={isMuted ? "Activar Sonidos" : "Silenciar"}
                >
                  {isMuted ? <VolumeX className="w-4.5 h-4.5 text-rose-300" /> : <Volume2 className="w-4.5 h-4.5 text-emerald-300" />}
                </button>

                {currentUser.rol === "Administrador" && (
                  <button
                    onClick={() => {
                      setCatalogFilter("todos");
                      setSearchTerm("");
                      setSelectedBlock(null);
                      setShowBlocks(false);
                      setShowOrder(false);
                      setActiveTab("inventory");
                      playSound("click");
                    }}
                    className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-600 active:scale-95 transition rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider shadow-sm cursor-pointer bg-custom-buttons"
                  >
                    <Package className="w-4 h-4" />
                    Inventario
                  </button>
                )}

                <button
                  onClick={() => {
                    setCurrentUser(null);
                    localStorage.removeItem("current_user");
                    playSound("close");
                    showToast("Sesión cerrada correctamente");
                  }}
                  title="Cerrar Sesión"
                  className="flex items-center justify-center bg-teal-950/60 hover:bg-rose-700 active:scale-95 transition rounded-xl p-2.5 text-white shadow-sm cursor-pointer"
                >
                  <LogOut className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* Menu Tabs Navigation */}
            <div className="px-6 pb-3 flex overflow-x-auto chip-scroll items-center gap-2.5 shrink-0">
              {enabledModules.includes("inventory") && (
                <button
                  onClick={() => {
                    setActiveTab("inventory");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                    playSound("click");
                  }}
                  className={`rounded-full px-5 py-2 text-xs font-bold shadow-sm transition active:scale-95 cursor-pointer ${
                    activeTab === "inventory" && !selectedBlock && !showOrder
                      ? "bg-white text-teal-800 font-extrabold"
                      : "bg-teal-700/50 text-teal-100 hover:bg-teal-700/80"
                  }`}
                >
                  Suministros
                </button>
              )}

              {enabledModules.includes("carga_masiva") && (
                <button
                  onClick={() => {
                    setActiveTab("carga_masiva");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                    playSound("click");
                  }}
                  className={`rounded-full px-5 py-2 text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                    activeTab === "carga_masiva"
                      ? "bg-white text-teal-800 font-extrabold"
                      : "bg-teal-700/50 text-teal-100 hover:bg-teal-700/80"
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Carga Masiva
                </button>
              )}

              {/* Solicitudes & Órdenes (Shared/Collapsible panel based on role) */}
              {enabledModules.includes("solicitudes") && (
                <button
                  onClick={() => {
                    setActiveTab("solicitudes");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                    playSound("click");
                  }}
                  className={`rounded-full px-5 py-2 text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                    activeTab === "solicitudes"
                      ? "bg-white text-teal-800 font-extrabold"
                      : "bg-teal-700/50 text-teal-100 hover:bg-teal-700/80"
                  }`}
                >
                  <ClipboardList className="w-4 h-4" />
                  <span>{currentUser.rol === "Administrador" ? "Órdenes" : "Solicitudes"}</span>
                </button>
              )}

              {enabledModules.includes("historial") && (
                <button
                  onClick={() => {
                    setActiveTab("historial");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                    playSound("click");
                  }}
                  className={`rounded-full px-5 py-2 text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                    activeTab === "historial"
                      ? "bg-white text-teal-800 font-extrabold"
                      : "bg-teal-700/50 text-teal-100 hover:bg-teal-700/80"
                  }`}
                >
                  <History className="w-4 h-4" />
                  Historial Movs
                </button>
              )}

              {enabledModules.includes("usuarios") && (
                <button
                  onClick={() => {
                    setActiveTab("usuarios");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                    playSound("click");
                  }}
                  className={`rounded-full px-5 py-2 text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                    activeTab === "usuarios"
                      ? "bg-white text-teal-800 font-extrabold"
                      : "bg-teal-700/50 text-teal-100 hover:bg-teal-700/80"
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Personal
                </button>
              )}

              {enabledModules.includes("configuracion") && (
                <button
                  onClick={() => {
                    setActiveTab("configuracion");
                    setShowBlocks(false);
                    setSelectedBlock(null);
                    playSound("click");
                  }}
                  className={`rounded-full px-5 py-2 text-xs font-bold shadow-sm transition active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                    activeTab === "configuracion"
                      ? "bg-white text-teal-800 font-extrabold"
                      : "bg-teal-700/50 text-teal-100 hover:bg-teal-700/80"
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  Configurar
                </button>
              )}

              {enabledModules.includes("inventory") && (
                <>
                  <div className="h-6 w-px bg-teal-700/50 hidden sm:block"></div>

                  <button
                    onClick={() => {
                      setActiveTab("inventory");
                      setShowBlocks(!showBlocks);
                      setSelectedBlock(null);
                      playSound("click");
                    }}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 border transition text-xs font-bold active:scale-95 cursor-pointer ${
                      showBlocks ? "bg-white text-teal-800 border-teal-500" : "bg-teal-700/50 text-teal-100 border-transparent hover:bg-teal-700/80"
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    Bloques
                  </button>

                  <button
                    onClick={() => {
                      setActiveTab("inventory");
                      setShowBlocks(false);
                      setSelectedBlock(null);
                      setShowOrder(!showOrder);
                      playSound("click");
                    }}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 border transition text-xs font-bold active:scale-95 cursor-pointer ${
                      showOrder ? "bg-white text-teal-800 border-teal-500" : "bg-teal-700/50 text-teal-100 border-transparent hover:bg-teal-700/80"
                    }`}
                  >
                    <ShoppingCart className="w-4 h-4" />
                    Pedido {orderItems.length > 0 && `(${orderItems.length})`}
                  </button>
                </>
              )}
            </div>

            {showBlocks && (
              <div id="blockSelector" className="anim-card-in px-6 pb-4 pt-1 bg-teal-900 flex flex-wrap gap-2">
                <span className="text-xs text-teal-200 font-bold self-center mr-2 uppercase tracking-wider">Módulos:</span>
                {BLOQUES.map((id) => {
                  const hasAssigned = blocks.find((b) => b.id === id)?.items.length > 0;
                  const isSelected = selectedBlock === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleSelectBlock(isSelected ? null : id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                        isSelected
                          ? "bg-white text-teal-900 shadow-md scale-105"
                          : hasAssigned
                          ? "bg-teal-700 hover:bg-teal-600 text-white border border-teal-500/50"
                          : "bg-teal-800/40 text-teal-300 hover:bg-teal-700/30"
                      }`}
                    >
                      B.{id}
                    </button>
                  );
                })}
              </div>
            )}
          </header>

          {/* Buscador y Filtros del Catálogo */}
          {activeTab === "inventory" && !selectedBlock && !showOrder && (
            <div className="bg-white border-b border-slate-200">
              <div className="max-w-4xl mx-auto px-6 py-4 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar medicamentos, insumos, lotes, descripción..."
                      value={searchQuery}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-50 text-slate-800 text-sm rounded-2xl pl-12 pr-4 py-3 outline-none focus:ring-2 focus:ring-teal-400 placeholder:text-slate-400 shadow-inner font-semibold"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUnverifiedOnly(prev => !prev);
                      playSound("click");
                    }}
                    className={`rounded-2xl px-4 py-3 text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer border ${
                      showUnverifiedOnly
                        ? "bg-amber-100 text-amber-800 border-amber-300 shadow-xs"
                        : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${showUnverifiedOnly ? "bg-amber-600 animate-pulse" : "bg-slate-300"}`}></span>
                    Sin verificar
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
                        className={`whitespace-nowrap text-xs font-bold px-4 py-2 rounded-full transition cursor-pointer ${
                          isSelected ? "bg-teal-700 text-white shadow-sm" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
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

          <main className="px-6 py-6 max-w-4xl mx-auto">
            {/* Contenido Principal */}
            {activeTab === "carga_masiva" && (
              <CargaMasiva
                products={products}
                currentUser={currentUser}
                onImportComplete={(updated) => setProducts(updated)}
                showToast={showToast}
                activeCatalogId={activeCatalogId}
              />
            )}

            {activeTab === "historial" && (
              <HistorialMovimientos
                activeCatalogId={activeCatalogId}
                currentUser={currentUser}
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

            {activeTab === "solicitudes" && (
              <SolicitudesPanel
                currentUser={currentUser}
                activePeriod={activePeriod}
                showToast={showToast}
                products={products}
                departamentos={departamentos}
                activeCatalogId={activeCatalogId}
                catalogos={catalogos}
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
              />
            )}

            {activeTab === "inventory" && (
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
                        showToast("La cantidad debe ser mayor que 0.");
                        return;
                      }
                      if (qty > lot.cantidad) {
                        showToast(`El lote solo dispone de ${lot.cantidad} unidades.`);
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
                    <div className="text-xs text-slate-500 font-bold uppercase tracking-wider flex justify-between items-center">
                      <span>Catálogo de Suministros ({getFilteredProducts().length})</span>
                      {catalogFilter === "prioridad" && (
                        <span className="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full text-[10px] font-black tracking-normal">
                          Orden de Prioridad Vencimiento
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {getFilteredProducts().map((p, idx) => {
                        const stats = getProductStats(p);
                        const coords = getProductCoordinates(p.codigo);

                        return (
                          <div
                            key={p.codigo}
                            onClick={() => handleOpenDetails(p.codigo)}
                            className="anim-card-in card-tap bg-white rounded-2xl shadow-sm border border-slate-200 p-5 cursor-pointer relative"
                            style={{ animationDelay: `${Math.min(idx, 15) * 25}ms` }}
                          >
                            <div className="flex justify-between items-start gap-4">
                              <div className="flex items-start gap-3.5 min-w-0">
                                {p.imagen || p.imagenURL ? (
                                  <img
                                    src={p.imagen || p.imagenURL}
                                    alt={p.nombre}
                                    className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0 shadow-sm"
                                  />
                                ) : (
                                  <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 text-slate-300 shadow-sm">
                                    <Package className="w-6 h-6" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <span className="block text-[10px] font-black text-teal-700 tracking-wider uppercase">
                                    {p.codigo}
                                  </span>
                                  <MarqueeText
                                    text={p.nombre}
                                    className="w-full"
                                    textClassName="font-extrabold text-slate-800 text-[15px] leading-tight"
                                  />
                                  <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                                    {p.descripcion || "Sin descripción adicional"}
                                  </p>
                                  {coords !== "No asignado" && (
                                    <div className="flex items-center gap-1.5 mt-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                      <MapPin className="w-3.5 h-3.5 text-slate-300" />
                                      <span>{coords}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <p className="text-xl font-black text-slate-800 leading-none">{stats.totalStock}</p>
                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Sistema</span>
                                <p className="text-sm font-bold text-slate-600 mt-2 leading-none">{stats.physicalStock}</p>
                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Físico</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-slate-100">
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200/60 shadow-inner">
                                <Layers className="w-3.5 h-3.5 text-slate-400" />
                                {p.lotes.length} {p.lotes.length === 1 ? "lote" : "lotes"}
                              </span>

                              <button
                                type="button"
                                onClick={(e) => handleToggleVerification(e, p.codigo)}
                                className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full transition shadow-inner cursor-pointer ${
                                  p.verificado
                                    ? "bg-emerald-500 text-white"
                                    : "bg-slate-50 text-slate-400 border border-dashed border-slate-300 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50/20"
                                }`}
                              >
                                {p.verificado ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Verificado
                                  </>
                                ) : (
                                  <>
                                    <X className="w-3.5 h-3.5" />
                                    Verificar
                                  </>
                                )}
                              </button>

                              {stats.hasExpired && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-red-50 text-red-600 border border-red-100 shadow-inner animate-pulse">
                                  <TriangleAlert className="w-3.5 h-3.5" />
                                  Vencido
                                </span>
                              )}

                              {stats.hasSoonToExpire && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 shadow-inner">
                                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                                  Por vencer (≤30d)
                                </span>
                              )}

                              {stats.hasNextToExpire && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200 shadow-inner">
                                  <Clock className="w-3.5 h-3.5 text-yellow-500" />
                                  Próx. a vencer (≤90d)
                                </span>
                              )}

                              {stats.lowStock && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100 shadow-inner">
                                  <TrendingDown className="w-3.5 h-3.5" />
                                  Bajo
                                </span>
                              )}

                              {stats.wideMismatch && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 shadow-inner">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  Diferencia
                                </span>
                              )}

                              {stats.hasAdjusted && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 shadow-inner">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                                  Ajustado
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
              className="fixed bottom-6 right-6 z-30 bg-teal-600 hover:bg-teal-700 active:scale-95 transition text-white rounded-full shadow-lg shadow-teal-900/30 px-6 py-4 flex items-center gap-2 font-black uppercase text-xs tracking-wider cursor-pointer bg-custom-buttons"
            >
              <Plus className="w-5 h-5" />
              Registrar Producto
            </button>
          )}

          {/* Global Toast Alert */}
          {toastMessage && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-xs font-extrabold px-5 py-3.5 rounded-xl shadow-xl border border-slate-800 flex items-center gap-2 anim-toast">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Modal Detalles / Edición de Producto */}
          {selectedProductCode && (
            <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setSelectedProductCode(null)}></div>
              <div className="absolute inset-x-0 bottom-0 top-12 sm:relative sm:inset-auto sm:w-full sm:max-w-2xl sm:h-[85vh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                  <button onClick={() => setSelectedProductCode(null)} className="p-1.5 -ml-1.5 text-slate-500 active:scale-90 transition cursor-pointer">
                    <X className="w-6 h-6" />
                  </button>
                  <span className="text-xs font-black text-teal-700 bg-teal-50 px-3 py-1.5 rounded-full border border-teal-100 uppercase tracking-widest">
                    Suministro: {selectedProductCode}
                  </span>
                  <button onClick={handleDeleteProduct} className="p-1.5 text-rose-400 hover:text-rose-600 active:scale-90 transition cursor-pointer">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                  {/* Photo Upload Card */}
                  <div>
                    <div
                      onClick={triggerFileInput}
                      className="relative w-full h-52 rounded-2xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center cursor-pointer group shadow-inner"
                    >
                      {isPhotoUploading ? (
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <LoaderCircle className="w-8 h-8 animate-spin text-teal-600" />
                          <span className="text-xs font-semibold">Subiendo foto...</span>
                        </div>
                      ) : products.find((p) => p.codigo === selectedProductCode)?.imagen ||
                        products.find((p) => p.codigo === selectedProductCode)?.imagenURL ? (
                        <>
                          <img
                            src={
                              products.find((p) => p.codigo === selectedProductCode)?.imagen ||
                              products.find((p) => p.codigo === selectedProductCode)?.imagenURL
                            }
                            alt="Foto del suministro"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={handlePhotoDelete}
                            className="absolute top-3.5 right-3.5 bg-black/60 hover:bg-rose-600 text-white rounded-full w-8 h-8 flex items-center justify-center transition active:scale-95 shadow-md"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-400 p-4 text-center">
                          <Upload className="w-8 h-8 text-slate-300 group-hover:text-teal-500 transition-colors" />
                          <span className="text-xs font-semibold group-hover:text-teal-600 transition-colors">
                            Agregar una foto de referencia
                          </span>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </div>

                  <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-4 shadow-sm">
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Nombre del Suministro
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="mt-1.5 w-full text-sm rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:ring-2 focus:ring-teal-400 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Descripción o Presentación
                      </label>
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="mt-1.5 w-full text-sm rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:ring-2 focus:ring-teal-400"
                      />
                    </div>
                  </div>

                  {/* Lotes de este medicamento */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider">Lotes Registrados</h3>
                      <button
                        onClick={() => {
                          setShowLotAdd(true);
                          playSound("open");
                        }}
                        className="flex items-center gap-1.5 text-xs font-bold text-teal-700 bg-teal-50 px-3 py-2 rounded-xl active:scale-95 transition border border-teal-100 shadow-inner cursor-pointer"
                      >
                        <Plus className="w-4 h-4" /> Agregar Lote
                      </button>
                    </div>

                    <div className="space-y-4">
                      {editLotes.map((l) => {
                        const daysTo = getDaysToExpiration(l.fechaVencimiento);
                        const status = daysTo < 0 ? "vencido" : daysTo <= 30 ? "proximo" : (daysTo <= 90 ? "pronto" : "ok");

                        let cardBgClass = "bg-white border-slate-200";
                        if (status === "vencido") {
                          cardBgClass = "bg-rose-50/70 border-rose-200 shadow-rose-100/30";
                        } else if (status === "proximo") {
                          cardBgClass = "bg-amber-50/70 border-amber-200 shadow-amber-100/30";
                        } else if (status === "pronto") {
                          cardBgClass = "bg-yellow-50/40 border-yellow-200 shadow-yellow-100/20";
                        }

                        return (
                          <div
                            key={l.id}
                            className={`rounded-2xl border p-4 space-y-3.5 shadow-sm transition-all ${cardBgClass}`}
                          >
                            <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:items-center pb-2.5 border-b border-slate-100">
                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                N.º Lote: {l.numeroLote}
                              </span>
                              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                                {status === "vencido" && (
                                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-100">
                                    Vencido ({Math.abs(daysTo)} días atrás)
                                  </span>
                                )}
                                {status === "proximo" && (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 animate-pulse">
                                    Por vencer (en {daysTo} días)
                                  </span>
                                )}
                                {status === "pronto" && (
                                  <span className="text-[10px] font-bold text-yellow-700 bg-yellow-50 px-2.5 py-1 rounded-full border border-yellow-200">
                                    Vence pronto (en {daysTo} días)
                                  </span>
                                )}
                                {status === "ok" && (
                                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                                    Vigente ({daysTo} días rest.)
                                  </span>
                                )}
                                {l.articuloAjustado && (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                    Ajustado
                                  </span>
                                )}

                                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!coincidenLotesMap[l.id]}
                                    onChange={(e) => handleToggleCoincide(l.id, e.target.checked)}
                                    className="rounded text-teal-600 focus:ring-teal-400"
                                  />
                                  <span>Coincide</span>
                                </label>

                                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!l.articuloAjustado}
                                    onChange={(e) => handleEditLotField(l.id, "articuloAjustado", e.target.checked)}
                                    className="rounded text-amber-600 focus:ring-amber-400"
                                  />
                                  <span className="text-amber-800 font-bold">Ajustado</span>
                                </label>

                                <button
                                  onClick={() => handleDeleteLot(l.id)}
                                  className="text-slate-300 hover:text-rose-600 active:scale-95 transition cursor-pointer"
                                >
                                  <Trash2 className="w-4.5 h-4.5" />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                              <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase">
                                  Lote (Sistema)
                                </label>
                                <input
                                  type="text"
                                  value={l.numeroLote}
                                  onChange={(e) => handleEditLotField(l.id, "numeroLote", e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-bold text-slate-800 bg-slate-50"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-amber-600 uppercase flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5" /> Lote F (Físico)
                                </label>
                                <input
                                  type="text"
                                  value={l.loteFisico || ""}
                                  disabled={!!coincidenLotesMap[l.id]}
                                  onChange={(e) => handleEditLotField(l.id, "loteFisico", e.target.value)}
                                  placeholder="Ej. Estante B"
                                  className="mt-1 w-full rounded-lg border border-amber-200 bg-amber-50/50 disabled:bg-slate-100 disabled:border-slate-200 px-2.5 py-2 font-bold text-slate-800"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase">
                                  Cantidad (Sistema)
                                </label>
                                <input
                                  type="number"
                                  value={l.cantidad}
                                  onChange={(e) => handleEditLotField(l.id, "cantidad", Number(e.target.value))}
                                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-bold text-slate-800 bg-slate-50"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-amber-600 uppercase flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5" /> Cantidad F (Física)
                                </label>
                                <input
                                  type="number"
                                  value={l.cantidadF || 0}
                                  disabled={!!coincidenLotesMap[l.id]}
                                  onChange={(e) => handleEditLotField(l.id, "cantidadF", Number(e.target.value))}
                                  className="mt-1 w-full rounded-lg border border-amber-200 bg-amber-50/50 disabled:bg-slate-100 disabled:border-slate-200 px-2.5 py-2 font-bold text-slate-800"
                                />
                              </div>

                              <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase">
                                  Vencimiento (Sistema)
                                </label>
                                <input
                                  type="date"
                                  value={l.fechaVencimiento}
                                  onChange={(e) => handleEditLotField(l.id, "fechaVencimiento", e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-bold text-slate-800 bg-slate-50 text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-bold text-amber-600 uppercase flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5" /> Vencimiento F (Física)
                                </label>
                                <input
                                  type="date"
                                  value={l.fechaFisica || ""}
                                  disabled={!!coincidenLotesMap[l.id]}
                                  onChange={(e) => handleEditLotField(l.id, "fechaFisica", e.target.value)}
                                  className="mt-1 w-full rounded-lg border border-amber-200 bg-amber-50/50 disabled:bg-slate-100 disabled:border-slate-200 px-2.5 py-2 font-bold text-slate-800 text-xs"
                                />
                              </div>

                              <div className="sm:col-span-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">
                                  Costo Adquisición (RD$)
                                </label>
                                <input
                                  type="number"
                                  value={l.precio}
                                  onChange={(e) => handleEditLotField(l.id, "precio", Number(e.target.value))}
                                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-bold text-slate-800 bg-slate-50"
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
                    className="w-full bg-teal-600 hover:bg-teal-700 active:scale-95 transition text-white font-extrabold text-sm rounded-xl py-3.5 uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    Guardar Cambios
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Añadir Lote */}
          {showLotAdd && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setShowLotAdd(false)}></div>
              <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in max-h-[85vh]">
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 shrink-0 bg-slate-50">
                  <h2 className="font-bold text-slate-800">Agregar Nuevo Lote</h2>
                  <button onClick={() => setShowLotAdd(false)} className="p-1.5 text-slate-500 hover:text-slate-700 transition cursor-pointer">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Lote (Sistema) *</label>
                    <input
                      type="text"
                      placeholder="Ej. AB-202"
                      value={newLotNum}
                      onChange={(e) => setNewLotNum(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-slate-50"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cantidad (Sistema) *</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="0"
                        value={newLotQty}
                        onChange={(e) => setNewLotQty(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-amber-600 uppercase tracking-wider">Cantidad F (Física)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="Dejar vacío para igualar"
                        value={newLotQtyF}
                        onChange={(e) => setNewLotQtyF(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vencimiento (Sistema) *</label>
                      <input
                        type="date"
                        value={newLotExpDate}
                        onChange={(e) => setNewLotExpDate(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400 bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-amber-600 uppercase tracking-wider">Vencimiento F (Física)</label>
                      <input
                        type="date"
                        value={newLotPhysExpDate}
                        onChange={(e) => setNewLotPhysExpDate(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-amber-600 uppercase tracking-wider">Lote F (Físico) / Ubicación</label>
                    <input
                      type="text"
                      placeholder="Ej. Estante B"
                      value={newLotLocation}
                      onChange={(e) => setNewLotLocation(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Costo Adquisición (RD$) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={newLotPrice}
                      onChange={(e) => setNewLotPrice(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-slate-50"
                    />
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0">
                  <button
                    onClick={handleAddLot}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs py-3.5 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer"
                  >
                    Añadir Lote
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Registrar Nuevo Suministro */}
          {showProductAdd && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setShowProductAdd(false)}></div>
              <div className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in max-h-[90vh]">
                <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100 shrink-0">
                  <h2 className="font-black text-slate-800 text-lg uppercase tracking-wide">Nuevo Suministro</h2>
                  <button onClick={() => setShowProductAdd(false)} className="p-1.5 text-slate-400 hover:text-slate-600 transition cursor-pointer">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 bg-slate-50">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Código *</label>
                      <input
                        type="text"
                        placeholder="Ej. A100"
                        value={newProdCode}
                        onChange={(e) => setNewProdCode(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-white font-bold uppercase"
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre del Suministro *</label>
                      <input
                        type="text"
                        placeholder="Ej. Amoxicilina Jarabe"
                        value={newProdName}
                        onChange={(e) => setNewProdName(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Descripción o Presentación</label>
                    <input
                      type="text"
                      placeholder="Ej. 250mg/5ml Frasco"
                      value={newProdDesc}
                      onChange={(e) => setNewProdDesc(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                    />
                  </div>

                  <div className="pt-3 border-t border-slate-200/60">
                    <h4 className="text-xs font-black text-teal-800 uppercase tracking-wider mb-3">Primer Lote Inicial</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Lote (Sistema) *</label>
                        <input
                          type="text"
                          placeholder="Ej. LX-411"
                          value={newProdLotNum}
                          onChange={(e) => setNewProdLotNum(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-amber-600 uppercase tracking-wider">Lote F (Físico)</label>
                        <input
                          type="text"
                          placeholder="Ej. Estante A"
                          value={newProdLotLocation}
                          onChange={(e) => setNewProdLotLocation(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cantidad (Sistema) *</label>
                        <input
                          type="number"
                          min="1"
                          placeholder="0"
                          value={newProdLotQty}
                          onChange={(e) => setNewProdLotQty(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-amber-600 uppercase tracking-wider">Cantidad F (Física)</label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Opcional"
                          value={newProdLotQtyF}
                          onChange={(e) => setNewProdLotQtyF(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-3">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fecha (Vencimiento) *</label>
                        <input
                          type="date"
                          value={newProdLotExpDate}
                          onChange={(e) => setNewProdLotExpDate(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-amber-600 uppercase tracking-wider">Fecha F (Física)</label>
                        <input
                          type="date"
                          value={newProdLotPhysExpDate}
                          onChange={(e) => setNewProdLotPhysExpDate(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3.5 py-2.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Costo Adquisición (RD$) *</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={newProdLotPrice}
                        onChange={(e) => setNewProdLotPrice(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 shrink-0">
                  <button
                    onClick={handleAddProductSubmit}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs py-4 rounded-xl uppercase tracking-wider transition shadow-sm cursor-pointer"
                  >
                    Guardar Nuevo Suministro
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Global Lateral Chat drawer */}
          {!showProductAdd && <ChatLateral currentUser={currentUser} />}
        </div>
      )}
    </>
  );
}
