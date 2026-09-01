"use client";

import { Camera, CheckCircle2, QrCode, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type PosLoyaltyCustomer = {
  id: string;
  name: string;
  phoneMasked: string;
  pointsBalance: number;
  cardCode: string;
};

function formatPoints(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export function PosLoyaltyIdentifier({
  customer,
  onChange
}: {
  customer: PosLoyaltyCustomer | null;
  onChange: (customer: PosLoyaltyCustomer | null) => void;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const resolve = useCallback(async (rawValue?: string) => {
    const candidate = (rawValue ?? value).trim();
    if (loading || candidate.length < 12) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/loyalty/card/resolve", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: candidate })
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; customer?: PosLoyaltyCustomer } | null;
      if (!response.ok || !payload?.ok || !payload.customer) {
        setMessage("Карта не найдена. Проверьте QR или номер карты.");
        return;
      }
      onChange(payload.customer);
      setValue("");
    } catch {
      setMessage("Не удалось проверить карту. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }, [loading, onChange, value]);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    let active = true;
    let controls: { stop: () => void } | null = null;
    void import("@zxing/browser").then(async ({ BrowserQRCodeReader }) => {
      if (!active || !videoRef.current) return;
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
      controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result, _error, scannerControls) => {
          if (!result || !active) return;
          active = false;
          scannerControls.stop();
          setScannerOpen(false);
          void resolve(result.getText());
        }
      );
    }).catch(() => {
      if (!active) return;
      setScannerOpen(false);
      setMessage("Камера недоступна. Разрешите доступ или введите номер карты.");
    });
    return () => {
      active = false;
      controls?.stop();
    };
  }, [resolve, scannerOpen]);

  if (customer) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={19} />
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{customer.name}</p>
              <p className="mt-1 text-xs font-bold text-emerald-800/70">{customer.phoneMasked} · {formatPoints(customer.pointsBalance)} баллов · {customer.cardCode}</p>
            </div>
          </div>
          <button type="button" onClick={() => { onChange(null); setTimeout(() => inputRef.current?.focus(), 0); }} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-200 bg-white" aria-label="Убрать карту гостя"><X size={17} /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-black/10 bg-[#FAF9F7] p-3">
      <div className="flex items-center gap-2 text-xs font-black text-black/60"><QrCode size={16} />Карта гостя</div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_48px_48px] gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => { setValue(event.target.value.slice(0, 180)); setMessage(""); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void resolve(); } }}
          placeholder="Сканируйте QR или введите номер"
          autoComplete="off"
          inputMode="text"
          className="min-w-0 rounded-lg border border-black/10 bg-white px-3 text-sm font-bold outline-none focus:border-[#FB670A] focus:ring-4 focus:ring-[#FB670A]/10"
        />
        <button type="button" onClick={() => void resolve()} disabled={loading || value.trim().length < 12} className="grid min-h-12 place-items-center rounded-lg bg-[#111114] text-white disabled:opacity-35" aria-label="Найти карту"><Search size={19} /></button>
        <button type="button" onClick={() => { setMessage(""); setScannerOpen(true); }} className="grid min-h-12 place-items-center rounded-lg border border-black/10 bg-white text-[#111114]" aria-label="Сканировать QR камерой"><Camera size={19} /></button>
      </div>
      <p className={`mt-2 text-xs font-semibold ${message ? "text-red-600" : "text-black/45"}`}>{message || "Сканируйте камерой, аппаратным сканером или введите номер."}</p>
      {scannerOpen ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Сканирование карты гостя">
          <div className="w-full max-w-md overflow-hidden rounded-lg bg-[#111114] text-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div><strong className="text-sm font-black">Наведите на QR карты</strong><p className="mt-1 text-xs text-white/50">Код считается автоматически</p></div>
              <button type="button" onClick={() => setScannerOpen(false)} className="grid h-10 w-10 place-items-center rounded-lg border border-white/15" aria-label="Закрыть камеру"><X size={18} /></button>
            </header>
            <div className="relative aspect-square bg-black">
              <video ref={videoRef} muted playsInline autoPlay className="h-full w-full object-cover" />
              <span className="pointer-events-none absolute inset-[16%] rounded-lg border-2 border-[#FB670A] shadow-[0_0_0_999px_rgba(0,0,0,0.22)]" />
            </div>
            <p className="px-4 py-3 text-center text-xs font-semibold text-white/60">Камера используется только для чтения QR.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
