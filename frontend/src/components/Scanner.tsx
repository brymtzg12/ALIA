import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { BrowserMultiFormatReader } from '@zxing/browser';
import classes from './FloorControls.module.css';
// La cámara sigue abierta entre lecturas; una etiqueta solo se vuelve a aceptar tras este tiempo fuera de cuadro.
const REPEAT_MS = 2000;
// Solo se lee el recuadro central (proporción del cuadro de la cámara), para ignorar las etiquetas vecinas.
// Debe coincidir con .viewfinder en FloorControls.module.css.
const REGION = { x: 0.05, y: 0.32, width: 0.9, height: 0.36 };
const SCAN_EVERY_MS = 150;
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
    const element = video.current;
    let disposed = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = { text: '', at: 0 };
    const reader = new BrowserMultiFormatReader();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    function accept(text: string) {
      const now = Date.now();
      if (text === last.text && now - last.at < REPEAT_MS) { last.at = now; return; }
      last = { text, at: now };
      navigator.vibrate?.(60);
      setLastRead(text);
      callback.current(text);
    }
    function tick() {
      if (disposed) return;
      if (context && element.videoWidth && !pausedRef.current) {
        const sx = Math.round(element.videoWidth * REGION.x), sy = Math.round(element.videoHeight * REGION.y);
        const sw = Math.round(element.videoWidth * REGION.width), sh = Math.round(element.videoHeight * REGION.height);
        canvas.width = sw;
        canvas.height = sh;
        context.drawImage(element, sx, sy, sw, sh, 0, 0, sw, sh);
        try { accept(reader.decodeFromCanvas(canvas).getText()); } catch { /* Sin código en el recuadro. */ }
      }
      timer = setTimeout(tick, SCAN_EVERY_MS);
    }
    Promise.resolve().then(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })).then(media => {
      if (disposed) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      element.srcObject = media;
      void element.play().catch(() => undefined);
      tick();
    }).catch(() => {
      if (!disposed) { setError('No se pudo abrir la cámara. Permite su acceso y entra por HTTPS. También puedes escribir el código.'); setActive(false); }
    });
    return () => { disposed = true; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); element.srcObject = null; };
  }, [active]);
  return <Stack>{error && <Alert color="red">{error}</Alert>}<Button variant="light" size="lg" onClick={() => { setError(''); setLastRead(''); setActive(value => !value); }}>{active ? 'Cerrar cámara' : 'Escanear con cámara'}</Button>{active && <><div className={classes.viewport}><video ref={video} className={classes.video} muted playsInline /><div className={classes.viewfinder} aria-hidden="true" /></div><Text size="sm" c="dimmed" aria-live="polite">{lastRead ? <>Leído: <span className={classes.lastRead}>{lastRead}</span>. Centra la siguiente etiqueta en el recuadro.</> : 'Centra una etiqueta dentro del recuadro amarillo. Solo se lee lo que quede dentro; la cámara se queda abierta para leer varias seguidas.'}</Text></>}</Stack>;
}
