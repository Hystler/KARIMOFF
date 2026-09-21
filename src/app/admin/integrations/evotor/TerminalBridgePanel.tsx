"use client";

import { useActionState } from "react";
import { Link2, Send, Smartphone } from "lucide-react";
import type { TerminalBridgeDevice } from "@/lib/integrations/evotor/terminal-bridge";
import {
  createTerminalPairingCodeAction,
  queueTerminalTestPreviewAction
} from "./actions";
import type { TerminalBridgeActionState } from "./actions";

const initialTerminalBridgeActionState: TerminalBridgeActionState = {
  status: "idle",
  message: ""
};

export function TerminalBridgePanel({
  enabled,
  devices,
  locationId
}: {
  enabled: boolean;
  devices: TerminalBridgeDevice[];
  locationId: string;
}) {
  const [pairing, pairingAction, pairingPending] = useActionState(
    createTerminalPairingCodeAction,
    initialTerminalBridgeActionState
  );
  const [preview, previewAction, previewPending] = useActionState(
    queueTerminalTestPreviewAction,
    initialTerminalBridgeActionState
  );

  return (
    <section className="admin-card mt-7 p-5 sm:p-6" aria-labelledby="terminal-bridge-title">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="admin-eyebrow">Смарт-терминал</p>
          <h2 id="terminal-bridge-title" className="mt-2 text-xl font-black">KARIMOFF Terminal Bridge</h2>
          <p className="mt-2 text-sm leading-6 text-karimoff-muted">
            Защищённая доставка тестовых заказов на Эвотор. Этот этап только показывает состав и сумму:
            чек, печать, ФН и эквайринг не запускаются.
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-black ${
          enabled ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
        }`}>
          <Smartphone size={16} /> {enabled ? "Сервер готов" : "Нужна настройка сервера"}
        </span>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <form action={pairingAction} className="rounded-lg border border-karimoff-line p-4">
          <input type="hidden" name="location_id" value={locationId} />
          <h3 className="flex items-center gap-2 font-black"><Link2 size={18} /> Привязка кассы</h3>
          <p className="mt-2 text-sm leading-6 text-karimoff-muted">
            Код одноразовый и действует 10 минут. Введите его только в приложении на Эвоторе.
          </p>
          {pairing.pairingCode ? (
            <output className="mt-4 block rounded-md bg-karimoff-soft px-4 py-4 text-center font-mono text-3xl font-black tracking-widest">
              {pairing.pairingCode.slice(0, 4)} {pairing.pairingCode.slice(4)}
            </output>
          ) : null}
          {pairing.message ? (
            <p className={`mt-3 text-sm font-semibold ${pairing.status === "error" ? "text-red-700" : "text-emerald-800"}`}>
              {pairing.message}
            </p>
          ) : null}
          <button type="submit" className="admin-secondary-button mt-4" disabled={!enabled || pairingPending}>
            <Link2 size={17} /> {pairingPending ? "Создаём…" : "Получить код"}
          </button>
        </form>

        <form action={previewAction} className="rounded-lg border border-karimoff-line p-4">
          <h3 className="flex items-center gap-2 font-black"><Send size={18} /> Проверка сервера</h3>
          <label className="mt-3 grid gap-2 text-sm font-bold">
            Касса
            <select name="device_id" className="admin-field" disabled={!devices.length} required>
              {devices.length ? devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}{device.lastSeenAt ? " · подключалась" : ""}
                </option>
              )) : <option value="">Сначала привяжите кассу</option>}
            </select>
          </label>
          {preview.message ? (
            <p className={`mt-3 text-sm font-semibold ${preview.status === "error" ? "text-red-700" : "text-emerald-800"}`}>
              {preview.message}
            </p>
          ) : null}
          <button type="submit" className="admin-primary-button mt-4" disabled={!enabled || !devices.length || previewPending}>
            <Send size={17} /> {previewPending ? "Отправляем…" : "Отправить тестовый заказ"}
          </button>
        </form>
      </div>
    </section>
  );
}
