import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
export default function LiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onmessage = message => {
      try {
        const data = JSON.parse(message.data);
        if (data.kind === 'health') client.setQueryData(['/health'], data);
        else if (data.kind === 'event' || data.kind === 'kit_complete') {
          void client.invalidateQueries();
          if (data.kind === 'kit_complete') notifications.show({ title: 'Kit completo', message: 'Orden ' + data.code, color: 'green' });
        }
      } catch { /* Los latidos no cambian las consultas. */ }
    };
    return () => source.close();
  }, [client]);
  return null;
}
