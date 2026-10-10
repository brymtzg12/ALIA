# Frontend KitListo
Requiere Node 24. Desde esta carpeta:
    npm ci
    npm run dev
Abre https://localhost:5173. En celular usa https://<IP-de-la-laptop>:5173, acepta el certificado y permite la cámara. Ambos equipos deben compartir red.

El backend debe estar encendido en http://localhost:8000. Vite dirige /api al backend, incluido /api/stream. La aplicación usa datos reales, eventos SSE y refresco cada 15 segundos.

Pantallas: almacén con búsqueda, órdenes y materiales, disponibilidad y kardex de piezas, recepciones pendientes con relación manual, salud, pronóstico y /piso/retirar con cámara o entrada manual. Los SKU ambiguos requieren elegir una pieza. El retiro preselecciona la primera orden con reserva y muestra errores de la API.

Validación:
    npm run build

Para producción sirve dist/ con fallback a index.html y un proxy /api al backend que quite el prefijo y permita conexiones SSE. npm run preview solo previsualiza el build; no configura ese proxy.

El kit original y el backend se mantienen sin modificaciones. Transferencias, conteos y políticas no tienen pantallas en esta versión.

Prueba con backend:
1. Verifica /health: catalog_ready=true y rebuilding=false.
2. Sigue la demo de la guía: aprueba una inspección, recibe piezas y comprueba la notificación Kit completo.
3. En /piso/retirar escanea ubicación y pieza, elige orden, cantidad y operador.
4. Confirma que la orden actualiza issued/reserved y que un retiro sin saldo muestra el error del backend.
