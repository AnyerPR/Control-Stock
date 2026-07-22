import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuración real del proyecto de Firebase proporcionada en la compilación
const firebaseConfig = {
  apiKey: "AIzaSyALcp6jIRkuRTi7J56BzsNinq8Wdtup600",
  authDomain: "control-stock-55201.firebaseapp.com",
  projectId: "control-stock-55201",
  storageBucket: "control-stock-55201.firebasestorage.app",
  messagingSenderId: "1097151750892",
  appId: "1:1097151750892:web:0bd7b0278d74b6d46bfbc9",
  measurementId: "G-3NMS631VKY"
};

let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.error("Firebase app initialization failed, creating mock:", e);
  app = {} as any;
}

let db: any;
try {
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase firestore initialization failed, creating mock:", e);
  db = {} as any;
}

let auth: any;
try {
  auth = getAuth(app);
} catch (e) {
  console.error("Firebase auth initialization failed, creating mock:", e);
  auth = {} as any;
}

export { db, auth };
