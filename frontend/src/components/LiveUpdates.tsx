import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { affectedQuery, type StockEvent } from '../eventLogic';
export default function LiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/stream');
    const pending: StockEvent[] = [];
    const seen = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule(event: StockEvent) {
      pending.push(event);
      if (timer) return;
      timer = setTimeout(() => {
        const events = pending.splice(0);
        timer = undefined;
        void client.invalidateQueries({ predicate: query => events.some(value => affectedQuery(String(query.queryKey[0]), value)) });
      }, 400);
    }
    source.onmessage = message => {
      try {
        const data = JSON.parse(message.data);
        if (data.kind === 'health') client.setQueryData(['/health'], data);
        else if (data.kind === 'kit_complete') {
          void client.invalidateQueries({ queryKey: ['/work-orders/' + encodeURIComponent(data.code) + '/materials'] });
          notifications.show({ title: 'Kit completo', message: 'Orden ' + data.code, color: 'green' });
        } else if (data.kind === 'event' && data.event?.data) {
          const event: StockEvent = data.event;
          if (event.event_id && seen.has(event.event_id)) return;
          if (event.event_id) { seen.add(event.event_id); if (seen.size > 500) seen.delete(seen.values().next().value!); }
          schedule(event);
          if (event.event_type === 'stock.shortage_detected') notifications.show({ title: 'Faltante detectado', message: String(event.data.name ?? 'Pieza') + ' · Orden ' + String(event.data.work_order_code ?? event.key) + ' · ' + String(event.data.missing_quantity ?? 'cantidad pendiente'), color: 'red' });
          if (event.event_type === 'stock.received') notifications.show({ title: 'Entrada de material', message: 'Pieza ' + String(event.data.part_id) + ': ' + String(event.data.quantity) + ' unidades recibidas.', color: 'green' });
        }
      } catch { /* Los latidos no cambian las consultas. */ }
    };
    return () => { source.close(); if (timer) clearTimeout(timer); };
  }, [client]);
  return null;
}
