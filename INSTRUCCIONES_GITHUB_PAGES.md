# Instrucciones para publicar en GitHub Pages y Abrir Localmente 🚀

Para facilitarte la exportación, el sistema de compilación genera automáticamente un **archivo único auto-contenido** listo para usarse.

---

## 🎯 ¿Cómo abrir la aplicación con un solo Click?

Hemos creado un archivo especial llamado **`index_2.html` directamente en la raíz de este proyecto**. 

* **Para abrirla localmente**: Cuando exportes este proyecto en formato **ZIP** desde el menú de la aplicación, solo tendrás que descomprimir el archivo ZIP y **hacer doble clic en `index_2.html`**. La aplicación se abrirá instantáneamente en tu navegador sin necesidad de instalar nada ni ejecutar servidores.

---

## 📂 Archivos generados en la compilación (`dist/`)

Al ejecutar `npm run build`, se crea la carpeta `dist/` con las siguientes opciones de distribución:

1. **`dist/index.html` (Versión Estándar Multi-archivo)**:
   - Es la estructura web tradicional (HTML + carpeta `assets` con JS y CSS optimizados).
   - **Optimizado para GitHub Pages**: Se configuró con rutas relativas (`base: "./"`), lo que significa que cargará perfectamente en subcarpetas de GitHub Pages (ej. `https://tu-usuario.github.io/tu-repositorio/`) sin fallos de rutas de recursos.

2. **`dist/index_2.html` (Versión Única Auto-contenida)**:
   - Es **un solo archivo HTML completo** que incluye absolutamente todo: todo el código React, todos los estilos de Tailwind CSS, los íconos de Lucide y la persistencia de Firebase en un único documento. Es idéntico al `index_2.html` del directorio raíz.

---

## 🛠️ Cómo subirlo a GitHub Pages (2 Métodos Fáciles)

### Método 1: El camino ultra-rápido (Archivo único `index_2.html`)
Si quieres publicar la aplicación en 1 minuto sin preocuparte por carpetas o rutas:
1. Toma el archivo **`index_2.html`** de la raíz del proyecto.
2. Cámbiale el nombre a **`index.html`**.
3. Súbelo directamente a la raíz de tu repositorio en GitHub.
4. En GitHub, ve a **Settings** (Configuración) -> **Pages**.
5. Selecciona la rama (usualmente `main` o `master`), la carpeta `/ (root)` y haz clic en **Save**.
6. **¡Listo!** Tu aplicación estará en línea al instante.

### Método 2: El camino estándar (Suministrar la carpeta `dist/`)
Si prefieres usar la compilación multi-archivo estándar:
1. Sube todo el contenido de la carpeta `dist/` (incluyendo la carpeta `assets`) a la raíz de tu repositorio de GitHub.
2. Ve a **Settings** -> **Pages** en tu repositorio.
3. Asegúrate de que apunte a la rama donde subiste los archivos y a la carpeta `/ (root)`.
4. Guarda y listo. Gracias a las rutas relativas (`base: "./"`), las hojas de estilo y scripts cargarán correctamente.

---

## 💻 Desarrollo Local

Para continuar desarrollando y probando localmente:
- Instala las dependencias: `npm install`
- Corre el servidor de desarrollo: `npm run dev`
- Genera los listos para subir: `npm run build`
