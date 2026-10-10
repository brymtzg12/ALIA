
type Check = () => Promise<boolean>;
let check: Check = async () => true;

export function setCatalogSyncCheck(fn: Check) {
  check = fn;
}

export function isCatalogInSync(): Promise<boolean> {
  return check();
}
