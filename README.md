# ALIA · Almacén Logístico Inteligente Automatizado

**ALIA** es el sistema de inventario del taller de **Roceel**. Sabe en todo momento qué piezas hay,
dónde están, qué está apartado para cada equipo en reparación y qué falta comprar, sin que nadie
tenga que ir a revisar el estante.

ALIA escucha en tiempo real la operación del taller (órdenes de trabajo, inspecciones, compras y
catálogo), lleva el inventario como un **libro mayor de movimientos** y responde al momento con
existencias, reservas, faltantes y sugerencias de compra. Incluye una app web para la oficina y para
el piso del almacén, con escaneo de etiquetas desde la cámara del celular.

- **Almacén:** existencia por pieza y por ubicación, con su historial completo (kardex).
- **Logístico:** reserva piezas para cada orden, surte faltantes cuando llega la compra y registra salidas, transferencias y conteos.
- **Inteligente:** relaciona compras con el catálogo, sugiere mínimos y máximos y pronostica la demanda por modelo.
- **Automatizado:** todo ocurre solo a partir de los eventos del taller, y avisa en vivo cuando falta algo o un kit queda completo.

## Levantar ALIA con un comando

Solo necesitas **Docker** (Docker Desktop en Windows o macOS). Primero se levanta el kit de Roceel
con su propio comando y, sobre él, ALIA completo (base de datos, backend y app) con **un comando**:

```bash
git clone https://github.com/brymtzg12/almacenInteligente.git
cd almacenInteligente

# Kit de Roceel: Redpanda, consola y simulador del taller
cd hackathon-inventario-kit && docker compose up -d && cd ..

# ALIA, sobre el kit
docker compose up -d --build
```

El primer arranque construye las imágenes (1 a 2 minutos). Después:

| Dirección | Qué es |
|---|---|
| **https://localhost:4173** | **App ALIA** (acepta el aviso del certificado local; también funciona desde el celular con la IP de la laptop) |
| http://localhost:8000/health | Estado del backend: listo cuando dice `"catalog_ready": true` y `"rebuilding": false` |
| http://localhost:8090 | Panel del simulador de Roceel |

ALIA se conecta a la red del kit para hablar con Redpanda, crea su base y, si los tópicos ya tienen
historia, la relee desde el inicio (catálogo primero). Las pruebas de contrato del kit se corren como
indica Roceel, con la API en el puerto 8000:

```bash
cd hackathon-inventario-kit
docker compose run --rm contract-tests --api http://host.docker.internal:8000
```

| Para | Comando (desde la raíz del repo) |
|---|---|
| Ver los registros del backend | `docker compose logs -f backend` |
| Detener ALIA conservando sus datos | `docker compose stop` (y `docker compose start` para volver) |
| Reconstruir la base desde cero | `docker compose down -v` y luego `docker compose up -d` |
| Detener el kit | `cd hackathon-inventario-kit && docker compose stop` |
| Dejar todo limpio después de las pruebas de contrato | `docker compose stop backend`, luego en `hackathon-inventario-kit/`: `RESET=1 SPEED=0 docker compose up -d --force-recreate simulator` (espera `replay terminado: 1742 eventos` en `docker compose logs simulator`), y de vuelta en la raíz: `docker compose down -v` y `docker compose up -d` |

> Mantén un solo servicio de inventario conectado al broker a la vez: ALIA en Docker o el modo
> desarrollo (`pnpm dev`), para que las pruebas de contrato vean solo los eventos de uno.
>
> Para detener el kit usa `docker compose stop`: así se conservan los tópicos, que Redpanda guarda
> en el volumen de su contenedor.

Las respuestas a cómo relacionamos compras, cómo manejamos kits, cómo evitamos reservas dobles y cómo
garantizamos idempotencia están en **[DECISIONES.md](DECISIONES.md)**.

## Funciones avanzadas

| Función | Dónde verla en ALIA |
|---|---|
| Pronóstico de demanda por modelo | Pantalla **Pronóstico** (`/pronostico`) · `GET /forecast/models/:id` y `GET /forecast/open-orders` |
| Valuación a costo promedio (MXN y USD) | Pantalla **Valuación** (`/valuacion`) · `GET /valuation`. USD se convierte con un tipo de cambio fijo (`USD_MXN`) |
| Tablero de rotación | Pantalla **Rotación** (`/rotacion`): piezas críticas y sin movimiento · `GET /rotation` |
| Observabilidad del consumidor | Pantalla **Salud del sistema** (`/salud`) · `GET /health`: lag por tópico, procesados, errores, estacionados y DLQ |
| Mínimos y máximos | Pantalla **Políticas** (`/politicas`), con recomendación por uso histórico |

## Recursos de Roceel

ALIA está construido sobre el **kit técnico que nos entregó Roceel**, en la carpeta
`hackathon-inventario-kit/`. Esa carpeta contiene el material de Roceel; nuestro código vive en
`backend/` y `frontend/`.

| Recurso de Roceel | Dónde | Cómo lo usa ALIA |
|---|---|---|
| **Contrato de eventos y API** (JSON Schema, OpenAPI y reglas de negocio) | `contract/` | ALIA valida cada evento de entrada y salida contra estos esquemas al arrancar y al procesar, e implementa la API tal como está descrita |
| **Simulador del taller** con panel web | `simulator/` · http://localhost:8090 | Publica la operación del taller en Kafka. Desde el panel se abren órdenes, se aprueban inspecciones y se registran compras |
| **Broker Redpanda** (API de Kafka) y su consola | `docker-compose.yml` · `localhost:19092` · http://localhost:8080 | Es el canal por el que ALIA recibe y publica eventos |
| **Historia de seis semanas** del taller | `data/events.jsonl` | Permite cargar y probar ALIA sin broker (`pnpm replay`) y verificar el contrato (`pnpm check:contract`) |
| **Pruebas de contrato** | `contract-tests/` | Verifican que ALIA cumple el contrato de punta a punta |
| **Etiquetas Code 128** de ubicaciones, piezas y órdenes | `labels/etiquetas-demo.pdf` | Son las que se escanean con el celular en la app de piso |
| **Validador de eventos** | `tools/validate_events.py` | Revisa cualquier archivo de eventos contra el contrato |
| **Documento técnico** (PDF) | raíz del kit | Requerimientos del sistema de inventario para el taller |

## Cómo funciona

```
 Simulador del taller ──► Redpanda (Kafka) ──► Backend ALIA ──► PostgreSQL
 de Roceel (panel :8090)     (:19092)          (API :8000)       (:5433)
                                                    │
                                                    ├──► eventos de salida (stock.*) de vuelta a Kafka
                                                    └──► /stream (en vivo) ──► App ALIA (:5173, PC o celular)
```

1. El **simulador de Roceel** publica en Kafka la operación del taller: catálogo, órdenes, inspecciones y compras.
2. El **backend de ALIA** consume esos eventos, reserva piezas para cada orden, detecta faltantes,
   relaciona las compras con el catálogo y publica sus propios eventos (`stock.reserved`,
   `stock.shortage_detected`…).
3. La **app de ALIA** consulta la API y se actualiza en vivo. En el piso, el operador escanea
   ubicación, pieza y orden para registrar salidas, transferencias y conteos.

Las decisiones técnicas están en [DECISIONES.md](DECISIONES.md).

## Estructura del repositorio

| Carpeta | Qué es |
|---|---|
| `backend/` | Servicio de inventario de ALIA (Node 24 + TypeScript, PostgreSQL, Kafka), puerto 8000 |
| `frontend/` | App web de ALIA (React + Mantine): pantallas de consulta y app de piso con escaneo, puerto 5173 |
| `hackathon-inventario-kit/` | Kit técnico de Roceel: contrato, simulador, datos, pruebas y etiquetas |
| `docker-compose.yml` | ALIA completo en contenedores (PostgreSQL, backend y app), conectado a la red del kit |
| `DECISIONES.md` | Decisiones técnicas del sistema |

Equipo: Bryan (backend), Baruk (frontend), Maddox (integración) y Javier (producto).

## Modo desarrollo (Node.js + pnpm)

Para trabajar en el código, con recarga automática al guardar. Si solo quieres usar ALIA, basta con
[Levantar ALIA con un comando](#levantar-alia-con-un-comando). No uses los dos modos a la vez: comparten
el puerto 8000.

### Requisitos

| Herramienta | Para qué | Instalación en Windows |
|---|---|---|
| **Docker Desktop** | Kafka, simulador, PostgreSQL y pruebas de contrato | https://www.docker.com/products/docker-desktop |
| **Node.js 24** o superior | Backend y frontend | `winget install OpenJS.NodeJS` |
| **pnpm** | Gestor de paquetes | `winget install pnpm.pnpm` |
| **Git** | Clonar el repositorio | `winget install Git.Git` |

Comprueba las versiones con `node -v` (debe ser v24 o mayor), `pnpm -v` y `docker -v`.

### Instalación (una sola vez)

```powershell
git clone https://github.com/brymtzg12/almacenInteligente.git
cd almacenInteligente

# Backend
cd backend
copy .env.example .env        # en Git Bash, macOS o Linux: cp .env.example .env
pnpm install
cd ..

# Frontend
cd frontend
pnpm install
cd ..
```

El archivo `backend/.env` ya trae valores que funcionan en local:

| Variable | Valor por defecto | Qué es |
|---|---|---|
| `DATABASE_URL` | `postgres://kitlisto:kitlisto@localhost:5433/kitlisto` | PostgreSQL del `docker-compose.yml` del backend |
| `KAFKA_BROKERS` | `localhost:19092` | Broker de Roceel |
| `PORT` | `8000` | Puerto de la API |
| `CONTRACT_DIR` | `../hackathon-inventario-kit/contract` | Contrato de Roceel que ALIA valida al arrancar |
| `USD_MXN` | `18.50` | Tipo de cambio fijo para la valuación |

### Arranque (cada vez)

Abre **Docker Desktop** y espera a que diga *Engine running*. Después usa tres terminales:

```powershell
# Terminal 1 · Kafka, consola y simulador de Roceel
cd hackathon-inventario-kit
docker compose up -d

# Terminal 2 · Backend de ALIA (crea el esquema de la base al arrancar)
cd backend
docker compose up -d          # PostgreSQL en el puerto 5433
pnpm dev                      # API en http://localhost:8000

# Terminal 3 · App de ALIA
cd frontend
pnpm dev                      # https://localhost:5173
```

Comprueba que todo está listo en **http://localhost:8000/health**:
`"catalog_ready": true`, `"rebuilding": false`, `"errors": 0` y todos los `lag` de `consumers` en 0.
Al principio el simulador reproduce seis semanas de operación (unos 17 minutos a la velocidad normal),
así que los números siguen cambiando un rato.

### Direcciones útiles

| Dirección | Qué es |
|---|---|
| https://localhost:5173 | **App ALIA** (servidor de desarrollo) |
| https://localhost:4173 | App ALIA compilada, si corres `pnpm preview --host --port 4173` (recomendada para el celular) |
| http://localhost:8000/health | Estado del backend |
| http://localhost:8000/stream | Eventos en vivo, útil para ver qué pasa sin recargar |
| http://localhost:8090 | Panel del simulador de Roceel: abrir órdenes, aprobar inspecciones, registrar compras |
| http://localhost:8080 | Redpanda Console: ver los tópicos y mensajes de Kafka |

## Verlo en la PC

1. Abre **https://localhost:4173** (con Docker) o **https://localhost:5173** (modo desarrollo) en Chrome o Edge.
2. La primera vez el navegador avisa que el certificado no es de confianza. Es un certificado local
   que genera Vite (se necesita HTTPS para usar la cámara). Elige **Configuración avanzada → Continuar**.
3. La app abre en **Almacén**. Desde el menú lateral llegas a todas las pantallas; el botón
   amarillo **Modo piso** lleva directo a las operaciones con escáner.
4. El botón de sol/luna del encabezado cambia entre modo claro y oscuro.

Para ver cómo queda en un celular sin tener uno a la mano: **F12 → Ctrl+Shift+M** y elige un ancho de 375 px.

## Verlo en el celular

El celular abre la app en su navegador, conectado a la laptop donde corre todo.

### Opción recomendada: versión compilada (puerto 4173)

Si levantaste ALIA con Docker, la app ya corre compilada en el puerto 4173: salta directo a *Pasos*.

En el celular conviene usar la versión compilada de la app (puerto 4173). Es un solo paquete: carga
más rápido por un hotspot y se mantiene estable durante una demostración. El servidor de desarrollo
(`pnpm dev`, puerto 5173) manda muchos archivos sueltos y, por hotspot, el iPhone puede quedarse en
**pantalla negra**.

```powershell
cd frontend
pnpm build                    # genera dist/ (repetir cada vez que cambie el código)
pnpm preview --host --port 4173
```

`pnpm preview` usa la misma configuración que `pnpm dev`: HTTPS con certificado local y redirección
de `/api` al backend del puerto 8000, incluidos los avisos en vivo. El backend debe estar encendido.

### Pasos

1. Conecta la laptop y el celular a la **misma red WiFi**. Si el celular es el punto de acceso
   (hotspot), basta con conectar la laptop a él.
2. Busca la IP de la laptop: en PowerShell ejecuta `ipconfig` y copia la **Dirección IPv4** del
   adaptador WiFi (por ejemplo `172.20.10.11`).
3. En el celular abre **https://172.20.10.11:4173** (con tu IP; con `pnpm dev` el puerto es 5173).
   Escribe la dirección completa, con `https://` y el puerto.
4. Acepta el aviso del certificado. En Safari: **Mostrar detalles → visitar este sitio web**.
   Cada puerto tiene su propio aviso.
5. Entra a **Modo piso**, pulsa **Escanear con cámara** y **permite el acceso a la cámara**.
6. Escanea las etiquetas Code 128 de Roceel en [`hackathon-inventario-kit/labels/etiquetas-demo.pdf`](hackathon-inventario-kit/labels/etiquetas-demo.pdf)
   (impresas o abiertas en otra pantalla). Si la cámara no está disponible, escribe el código en
   **Código de etiqueta** y pulsa **Leer código**.

> **La IP cambia cada vez que la laptop cambia de red.** Si el celular deja de cargar, lo primero
> es volver a correr `ipconfig` y usar la IP nueva. Para una demostración, deja la laptop fija en
> un solo hotspot.

### Si el celular no carga

| Síntoma | Causa y solución |
|---|---|
| No conecta / se queda cargando | La IP cambió o el celular está en otra red. Revisa `ipconfig` y que ambos estén en la misma WiFi |
| Pantalla negra o en blanco | Caché vieja del navegador tras reiniciar el servidor. Abre una **pestaña privada**, borra la caché o usa la versión compilada (4173) |
| Funciona en la laptop pero no en el celular, con la IP correcta | **Firewall de Windows:** en *Panel de control → Firewall de Windows Defender → Permitir una aplicación*, marca **Node.js** en **Privada y Pública**. Windows aplica el permiso según el tipo de red (pública o privada), así que cambiar el tipo de red puede bloquearlo |
| Sigue sin cargar en una WiFi de evento, escuela u oficina | Esas redes suelen **aislar a los dispositivos entre sí**. Usa el hotspot del celular |
| La cámara no abre | La dirección debe empezar con **https**: el navegador solo permite la cámara en páginas seguras |

## Pantallas de la app

| Grupo | Pantalla | Ruta | Para qué |
|---|---|---|---|
| Operación de piso | Retirar piezas | `/piso/retirar` | Escanear ubicación, pieza y orden y registrar la salida |
| | Transferir piezas | `/piso/transferir` | Mover piezas de una ubicación a otra |
| | Contar piezas | `/piso/contar` | Conteo físico de una ubicación y ajustes |
| Almacén | Almacén | `/almacen` | Resumen, faltantes abiertos, sugerencias de compra, inventario por pieza y existencias por ubicación |
| | Órdenes de trabajo | `/ordenes` | Búsqueda de cualquier orden por código y lista de abiertas; cada orden muestra lo reservado, entregado y pendiente por kit |
| | Recepciones | `/recepciones` | Compras que no se pudieron relacionar con una pieza |
| Planeación | Pronóstico | `/pronostico` | Demanda esperada por modelo a partir de inspecciones aprobadas |
| | Políticas | `/politicas` | Mínimos y máximos por pieza y recomendaciones |
| Análisis | Valuación | `/valuacion` | Valor del inventario a costo promedio |
| | Rotación | `/rotacion` | Piezas críticas y piezas sin movimiento |
| Sistema | Salud del sistema | `/salud` | Estado del backend y del consumo de Kafka |

Además, `/ordenes/<código>` muestra los materiales de una orden y `/piezas/<id>`, la existencia por
ubicación y el kardex de una pieza. La app avisa en vivo cuando se detecta un faltante, llega material
o un kit queda completo. Más detalle en [`frontend/README.md`](frontend/README.md).

## Recorrido de demostración

1. En el **panel del simulador de Roceel** (http://localhost:8090) abre una orden y aprueba su inspección.
2. En ALIA, la orden aparece en **Órdenes de trabajo** con sus reservas y faltantes, y el aviso de
   faltante llega en vivo.
3. En el panel registra la **llegada de la compra**: el faltante se cierra y aparece el aviso **Kit completo**.
4. En el celular, en **Retirar piezas**, escanea la ubicación U-100, la pieza y la orden y confirma la salida.

## Comandos útiles

**Backend** (desde `backend/`):

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca la API y el consumo de Kafka, y se reinicia al guardar cambios |
| `pnpm start` | Arranca sin recarga automática |
| `pnpm migrate` | Crea o actualiza el esquema de la base |
| `pnpm reset` | Borra todos los datos de la base y recrea el esquema desde cero |
| `pnpm check:contract` | Valida que el contrato de Roceel compila y que la historia de seis semanas es válida (no necesita base ni broker) |
| `pnpm replay -- <archivo> [--reset] [--catalog-first]` | Procesa un archivo de eventos sin broker (por defecto, `hackathon-inventario-kit/data/events.jsonl`) |
| `pnpm demo:reset` | Deja todo limpio para una demostración: recarga los tópicos y reconstruye la base (~25 s, con `pnpm dev` corriendo) |
| `pnpm demo:reset --keep-topics` | Solo reconstruye la base, sin tocar Kafka |
| `pnpm demo:reset --snapshot` | Además guarda una foto de los saldos en `backend/saldo.json` |

**Frontend** (desde `frontend/`):

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo en https://localhost:5173 (también visible en la red local) |
| `pnpm build` | Revisa los tipos y genera la versión de producción en `dist/` |
| `pnpm test` | Pruebas de la lógica de piso, kits, eventos en vivo y llamadas a la API |
| `pnpm preview --host --port 4173` | Sirve el build en https://localhost:4173 y en la red local, con la misma redirección de `/api` al backend. Recomendado para el celular |

**Kit técnico de Roceel** (desde `hackathon-inventario-kit/`):

| Comando | Qué hace |
|---|---|
| `docker compose up -d` | Levanta Redpanda, la consola y el simulador |
| `SPEED=0 docker compose up -d` | Reproduce las seis semanas sin pausas (en PowerShell: `$env:SPEED=0; docker compose up -d`) |
| `RESET=1 docker compose up -d` | Borra y recrea los tópicos al arrancar el simulador |
| `docker compose logs -f simulator` | Ver lo que hace el simulador |
| `docker compose run --rm contract-tests --api http://host.docker.internal:8000` | Pruebas de contrato contra ALIA |
| `docker compose down` | Apaga el kit |

> Las pruebas de contrato dejan datos de prueba ("PIEZA DE PRUEBA", "MODELO 640768"). Antes de
> una demostración, corre `pnpm demo:reset --snapshot` en `backend/` (modo desarrollo) o sigue
> *Dejar todo limpio* en [Levantar ALIA con un comando](#levantar-alia-con-un-comando) (modo Docker).

## API

ALIA implementa la API descrita en el contrato de Roceel (`hackathon-inventario-kit/contract/openapi.yaml`).
Las rutas principales:

| Ruta | Qué devuelve o hace |
|---|---|
| `GET /health` | Estado del servicio y retraso de cada consumidor |
| `GET /stream` | Eventos en vivo (Server-Sent Events) |
| `GET /parts`, `/parts/:id`, `/parts/:id/availability`, `/parts/:id/ledger`, `/parts/:id/reservations` | Catálogo, existencia por ubicación, kardex y reservas |
| `GET /work-orders`, `/work-orders/:code/materials` | Órdenes y sus materiales por kit |
| `GET /shortages`, `/reorder-suggestions` | Faltantes abiertos y sugerencias de compra |
| `GET /locations`, `/locations/:id/stock` | Ubicaciones y su contenido |
| `GET /scan?code=…` | Identifica una etiqueta escaneada (ubicación, pieza u orden) |
| `POST /issues`, `/transfers`, `/counts` | Salidas, transferencias y conteos del piso |
| `GET /unmatched-receipts`, `POST /unmatched-receipts/:id/resolve` | Compras por relacionar y su resolución manual |
| `GET /valuation`, `/rotation`, `/forecast/open-orders`, `/forecast/models/:id` | Analítica |
| `GET /policies`, `/policies/recommended`, `PUT`/`DELETE /policies/:id` | Mínimos y máximos por pieza |

## Solución de problemas

| Síntoma | Qué revisar |
|---|---|
| `docker` no responde o falla `compose up` | Abre Docker Desktop y espera a *Engine running* |
| El backend dice `Falta la variable de entorno DATABASE_URL` | Falta `backend/.env`: cópialo de `.env.example` |
| El backend no conecta a la base | `docker compose up -d` en `backend/`; la base usa el puerto **5433** |
| `/health` muestra `rebuilding: true` o `lag` mayor a 0 | Todavía está procesando; espera unos segundos y recarga |
| La app muestra "No se pudo cargar" o "La API no devolvió JSON" | El backend no está encendido en el puerto 8000 |
| No llegan avisos en vivo | Revisa http://localhost:8000/stream y que el kit de Roceel esté arriba |
| La cámara no abre | Entra por **https** y permite la cámara en el navegador; mientras, escribe el código a mano |
| El celular no abre la página o queda en negro | Ver la tabla *Si el celular no carga* en *Verlo en el celular* |
| En Windows, `http://localhost:8000` se queda cargando | Docker Desktop (WSL) puede dejar ocupado el puerto en IPv6. Usa `http://127.0.0.1:8000`; la app, el celular y las pruebas de contrato (`host.docker.internal`) no se ven afectados |
| El puerto 5173 está ocupado | Ya hay otro `pnpm dev` corriendo; ciérralo o usa ese |
| Datos raros o de prueba | `pnpm demo:reset` en `backend/` |

## Documentación

| Documento | Contenido |
|---|---|
| [`DECISIONES.md`](DECISIONES.md) | Decisiones técnicas: compras y catálogo, kits, reservas dobles e idempotencia |
| [`frontend/README.md`](frontend/README.md) | Detalle de la app, reglas de retiro y validación |
| [`hackathon-inventario-kit/README.md`](hackathon-inventario-kit/README.md) | Kit técnico de Roceel: simulador, contrato y pruebas |
| [`hackathon-inventario-kit/contract/README.md`](hackathon-inventario-kit/contract/README.md) | Contrato de eventos y API de Roceel, estándar de etiquetas |
