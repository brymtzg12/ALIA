# ALIA · Decisiones técnicas

ALIA lleva el inventario del taller de Roceel como un **libro mayor de movimientos**: el saldo de cada pieza es la suma de sus movimientos, y reservas, faltantes y sugerencias se derivan de los eventos del taller.

## 1. ¿Cómo relacionamos compras con el catálogo?

**Solo se relaciona automáticamente una compra que coincide con exactamente una pieza. Nunca se adivina.**

1. Se quitan prefijos del número de parte (`NP:`, `N/P`, `P/N`, `PN-`).
2. Se compara contra el SKU: primero exacto normalizado (mayúsculas, sin espacios en los extremos) y, si no hay, compacto (además sin espacios internos, guiones, puntos, comas ni diagonales).
3. Si el SKU es compartido por varias piezas, se elige la única cuyo nombre es igual a la descripción.
4. Sin número de parte (`S/N …`) o sin coincidencia, la descripción se compara contra el SKU y luego contra el nombre.
5. Si no queda una sola pieza, va a **revisión manual** con candidatos sugeridos. Al resolverla, entra a U-100 y surte primero el faltante de su orden.

Las compras para cliente no entran al inventario. Si una compra no coincide mientras el catálogo aún se carga, se estaciona y se reintenta: su pieza puede venir en camino por otro tópico.

## 2. ¿Cómo manejamos los kits?

- **Inventariamos componentes, no kits.** Cada línea de la lista de partes tiene su propia necesidad, reserva y faltante, porque el taller compra componentes y uno mismo sirve a varios kits y modelos.
- **El kit es una agrupación:** las líneas con el mismo `group_name` (o el mismo nombre, si no tiene grupo) en la lista de partes vigente.
- Un kit está **completo** cuando todas sus líneas tienen lo requerido reservado o entregado. ALIA avisa en vivo cuando una orden queda completa.
- Una aprobación posterior **reemplaza** la cantidad de la línea, no la suma. Anular la inspección o dar de baja la orden libera reservas y cierra faltantes.

## 3. ¿Cómo evitamos reservas dobles?

- Toda operación que mueve saldo o reservas toma primero el **candado de la fila de saldo de la pieza** (`SELECT … FOR UPDATE`) y solo entonces calcula el disponible. Con varias piezas, los candados se toman en orden de `part_id` para evitar bloqueos cruzados.
- Se reserva el **mínimo entre lo disponible y lo pedido**; el resto es faltante. Si dos órdenes piden la última pieza, una la obtiene y la otra queda con faltante.
- Ante un bloqueo mutuo o una falla de serialización, la transacción completa se reintenta sola.
- Una salida que no alcanza en la ubicación o en la reserva de su orden responde 409 y no cambia nada.

## 4. ¿Cómo garantizamos idempotencia?

- **Cada evento se aplica una sola vez:** su `event_id` se registra en la **misma transacción** que sus efectos. Si llega de nuevo, no cambia ni publica nada.
- **Outbox:** los eventos de salida se guardan en esa misma transacción y luego se publican en Kafka. Una caída a la mitad no pierde ni duplica nada.
- **Fuera de orden:** lo que referencia algo aún desconocido se estaciona y se reintenta respetando el orden de su llave. Lo irrecuperable va a `inventory.dlq` sin detener el consumo.
- Salidas, transferencias y conteos llevan un `command_id` único, y cada línea de compra entra una sola vez (índices únicos).
- **Reconstrucción:** borrar la base y releer los tópicos (catálogo primero) da el mismo saldo. Verificado con la herramienta de Roceel: *mismo saldo en 256 piezas*.
