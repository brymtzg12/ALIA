# KitListo · Almacén inteligente para taller

Servicio de inventario para el taller de Roceel (Hackathon Saltillo): consume los eventos del
taller desde Kafka (Redpanda), lleva el inventario como libro mayor de movimientos y responde con
existencias, reservas, faltantes y sugerencias de compra en tiempo real.

## Estructura

| Carpeta | Qué es | Rama de trabajo |
|---|---|---|
| `hackathon-inventario-kit/` | Kit del reto (contrato, simulador, pruebas). **No se modifica.** | `main` |
| `backend/` | Servicio de inventario (Node 24 + TypeScript, PostgreSQL, Kafka), puerto 8000 | `backend` |
| `frontend/` | Pantallas y app de piso con escaneo | `frontend` |

Ramas por rol: `backend` (Bryan), `frontend` (Baruk), `integracion` (Maddox), `producto` (Javier).

## Arranque rápido

```bash
# 1. Broker, consola y simulador
cd hackathon-inventario-kit && docker compose up -d

# 2. Backend (requiere pnpm)
cd backend
cp .env.example .env
docker compose up -d      # PostgreSQL en el puerto 5433
pnpm install
pnpm dev                  # API en http://localhost:8000

# 3. Pruebas de contrato (desde hackathon-inventario-kit)
docker compose run --rm contract-tests --api http://host.docker.internal:8000
```

## Frontend
```bash
cd frontend
pnpm install
pnpm dev                  # https://localhost:5173
```
Abre https://localhost:5173 con el backend encendido en el puerto 8000.
Para un celular, usa https://<IP-de-la-laptop>:5173 en la misma red.
Consulta frontend/README.md para pantallas, validación y prueba de integración.
