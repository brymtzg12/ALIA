export type StockEvent = { event_id?: string; event_type: string; key?: string; data: Record<string, unknown> };
export function affectedQuery(path: string, event: StockEvent): boolean {
  const route = path.split('?')[0];
  const data = event.data;
  const partId = data.part_id;
  const order = data.work_order_code ?? (event.key?.startsWith('R') ? event.key : undefined);
  const isMovement = ['stock.received', 'stock.issued', 'stock.transferred', 'stock.adjusted'].includes(event.event_type);
  if (route.startsWith('/parts/')) return partId != null && route.startsWith('/parts/' + partId + '/');
  if (route.startsWith('/work-orders/')) return order ? route === '/work-orders/' + encodeURIComponent(String(order)) + '/materials' : isMovement;
  if (route.startsWith('/locations/')) return [data.location_id, data.from_location_id, data.to_location_id].some(id => id != null && route === '/locations/' + id + '/stock');
  if (['/parts', '/shortages', '/reorder-suggestions', '/work-orders', '/forecast/open-orders', '/policies'].includes(route)) return true;
  if (route === '/unmatched-receipts') return ['stock.unmatched_receipt', 'stock.received'].includes(event.event_type);
  if (route === '/valuation') return ['stock.received', 'stock.issued', 'stock.adjusted'].includes(event.event_type);
  if (route === '/rotation' || route === '/locations') return isMovement;
  return false;
}
