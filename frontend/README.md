# Frontend ALIA

Requiere Node 24 y pnpm (`winget install pnpm.pnpm`). Desde esta carpeta:

    pnpm install
    pnpm dev

pnpm usa versiones exactas y solo instala versiones publicadas hace más de 7 días, sin ejecutar scripts de instalación (`pnpm-workspace.yaml`).

Abre https://localhost:5173. En celular usa https://<IP-de-la-laptop>:5173, acepta el certificado y permite la cámara. Ambos equipos deben compartir red.

Para el celular o una demostración conviene la versión compilada: `pnpm build` y luego `pnpm preview --host --port 4173`, y abrir https://<IP-de-la-laptop>:4173. Carga más rápido por hotspot y evita la pantalla negra por caché que puede dejar el servidor de desarrollo al reiniciarse. Repite `pnpm build` cada vez que cambie el código. La IP cambia cuando la laptop cambia de red (`ipconfig`).

El backend debe estar encendido en http://localhost:8000. Vite dirige /api al backend, incluido /api/stream. La aplicación consulta datos reales. Los eventos SSE se agrupan durante 400 ms e invalidan las consultas afectadas; las vistas operativas también refrescan cada 15 segundos para cambios sin evento.

## Pantallas

- Almacén: búsqueda, faltantes y sugerencias de compra.
- Órdenes: materiales agrupados por kit, estados en español y colores.
- Piezas: disponibilidad por ubicación y kardex.
- Recepciones: relación manual con piezas sugeridas.
- Piso: retiro, transferencia y conteo con cámara o entrada manual.
- Pronóstico: órdenes sin inspección e histórico por modelo; funciona con histórico aunque haya cero órdenes pendientes de inspección.
- Valuación, rotación y políticas: mínimos/máximos editables y recomendaciones para revisar antes de guardar.
- Salud del sistema.

## Retiro y demo

La orden escaneada o elegida tiene prioridad y se conserva al escanear otra pieza. Cada orden muestra la suma de sus reservas para la pieza; quantity ya representa lo que queda apartado.

Sin selección explícita, se sugiere la orden con la mayor reserva si es única. Si el operador captura una cantidad, solo se sugiere automáticamente una orden cuando es la única con reserva suficiente. Si hay ambigüedad, se exige elegir o escanear.

La cantidad se prellena con la reserva de la orden seleccionada, salvo que el operador escriba otra. El máximo retirable es el menor entre la existencia en la ubicación y el disponible global más la reserva propia de la orden. El backend vuelve a validar todo al registrar.

El selector ¿Quién eres? permite guardar operadores en este navegador; no es autenticación. Los avisos en vivo incluyen faltantes, entradas y kit completo.

Para conteos, cero significa cero unidades y una casilla vacía no modifica la pieza. Se necesita motivo y al menos una línea válida. Transferencias requieren origen distinto de destino y saldo suficiente en el origen.

## Validación

    pnpm test
    pnpm build

Las pruebas cubren la orden vieja de INSERTO con dos apartadas frente a la orden de demo con seis, prioridad de selección explícita, reservas agregadas, ambigüedad, saldo, conteo cero, kits, eventos selectivos y cuerpos/errores de la API.

Prueba con backend real:
1. Verifica /health: catalog_ready=true y rebuilding=false.
2. Sigue la demo: aprueba una inspección, recibe piezas y comprueba la notificación Kit completo.
3. En /piso/retirar escanea la orden de demo antes o después de la pieza y comprueba que se conserva; muestra seis apartadas y cantidad seis.
4. Con reserva antigua de dos y disponible global de dos, elegir la orden antigua y pedir seis debe bloquear el botón. La orden demo con seis sí permite retirar si hay saldo en la ubicación.
5. Confirma que la orden actualiza issued/reserved. Revisa transferencias, conteos y políticas en un entorno de prueba.

Para producción sirve dist/ con fallback a index.html y un proxy /api al backend que quite el prefijo y permita SSE. pnpm preview sí reutiliza la configuración de vite.config.ts (HTTPS local y proxy /api, incluido el SSE), pero es para pruebas locales y demostraciones, no para producción.
