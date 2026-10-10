import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import classes from './FloorControls.module.css';
// La cámara sigue abierta entre lecturas; una etiqueta solo se vuelve a aceptar tras este tiempo fuera de cuadro.
const REPEAT_MS = 2000;
export default function Scanner({ onCode, paused = false }: { onCode: (code: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  callback.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const [lastRead, setLastRead] = useState('');
  useEffect(() => {
    if (!active || !video.current) return;
    let disposed = false;
    let controls: IScannerControls | undefined;
    let last = { text: '', at: 0 };
    const reader = new BrowserMultiFormatReader();
    reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, result => {
      if (!result || disposed || pausedRef.current) return;
      const text = result.getText();
      const now = Date.now();
      if (text === last.text && now - last.at < REPEAT_MS) { last.at = now; return; }
      last = { text, at: now };
      navigator.vibrate?.(60);
      setLastRead(text);
      callback.current(text);
    }).then(value => { controls = value; if (disposed) value.stop(); }).catch(() => {
      if (!disposed) { setError('No se pudo abrir la cámara. Permite su acceso y entra por HTTPS. También puedes escribir el código.'); setActive(false); }
    });
    return () => { disposed = true; controls?.stop(); };
  }, [active]);
  return <Stack>{error && <Alert color="red">{error}</Alert>}<Button variant="light" size="lg" onClick={() => { setError(''); setLastRead(''); setActive(value => !value); }}>{active ? 'Cerrar cámara' : 'Escanear con cámara'}</Button>{active && <><video ref={video} className={classes.video} muted playsInline /><Text size="sm" c="dimmed" aria-live="polite">{lastRead ? <>Leído: <span className={classes.lastRead}>{lastRead}</span>. Apunta a la siguiente etiqueta.</> : 'Apunta la cámara a una etiqueta. Se queda abierta para leer varias seguidas.'}</Text></>}</Stack>;
}
