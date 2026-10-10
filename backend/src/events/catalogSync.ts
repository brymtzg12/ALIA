// ¿El catálogo ya procesó todo lo que había publicado hasta este momento?
// Lo usa la recepción: una compra que no coincide mientras el catálogo va atrasado
// se estaciona en lugar de ir a revisión manual (la pieza puede venir en camino).
// Kafka registra la verificación real; en modo archivo el catálogo siempre está al día.

type Check = () => Promise<boolean>;
let check: Check = async () => true;

export function setCatalogSyncCheck(fn: Check) {
  check = fn;
}

export function isCatalogInSync(): Promise<boolean> {
  return check();
}
