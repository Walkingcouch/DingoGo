import { useEffect, useRef } from 'react';

/** Finger signature capture. Calls onChange with a PNG data URL (or null when cleared). */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#14213D';
  }, []);

  const pt = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const down = (e: React.PointerEvent) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; };
  const up = () => { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); };

  return (
    <div>
      <canvas ref={ref} className="sigpad" aria-label="Signature area — sign with your finger" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" style={{ marginTop: 8 }} onClick={clear}>Clear signature</button>
    </div>
  );
}
