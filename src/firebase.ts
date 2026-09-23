import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuración real del proyecto de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyALcp6jIRkuRTi7J56BzsNinq8Wdtup600",
  authDomain: "control-stock-55201.firebaseapp.com",
  projectId: "control-stock-55201",
  storageBucket: "control-stock-55201.firebasestorage.app",
  messagingSenderId: "1097151750892",
  appId: "1:1097151750892:web:0bd7b0278d74b6d46bfbc9",
  measurementId: "G-3NMS631VKY"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };


