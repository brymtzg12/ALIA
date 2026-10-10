import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack } from '@mantine/core';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import classes from './FloorControls.module.css';
export default function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  callback.current = onCode;
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active || !video.current) return;
    let disposed = false;
    let controls: IScannerControls | undefined;
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, (result, _error, scanner) => {
      if (result && !disposed) {
        scanner.stop();
        callback.current(result.getText());
        setActive(false);
      }
    }).then(value => { controls = value; if (disposed) value.stop(); }).catch(() => {
      if (!disposed) { setError('No se pudo abrir la cámara. Permite su acceso y entra por HTTPS. También puedes escribir el código.'); setActive(false); }
    });
    return () => { disposed = true; controls?.stop(); };
  }, [active]);
  return <Stack>{error && <Alert color="red">{error}</Alert>}<Button variant="light" size="lg" onClick={() => { setError(''); setActive(value => !value); }}>{active ? 'Cerrar cámara' : 'Escanear con cámara'}</Button>{active && <video ref={video} className={classes.video} muted playsInline />}</Stack>;
}
