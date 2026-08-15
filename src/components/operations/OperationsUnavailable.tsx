import { CircleAlert, RefreshCw } from "lucide-react";

export function OperationsUnavailable({
  title,
  message,
  embedded = false
}: {
  title: string;
  message: string;
  embedded?: boolean;
}) {
  return (
    <main className={embedded ? "min-w-0" : "grid min-h-dvh place-items-center bg-[#F3F1ED] p-5 text-[#121214]"}>
      <section className={`mx-auto w-full max-w-xl rounded-lg border border-amber-200 bg-white p-6 text-center shadow-sm ${embedded ? "my-6" : ""}`}>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-800">
          <CircleAlert size={24} />
        </span>
        <h1 className="mt-4 text-2xl font-black leading-tight">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-black/55">{message}</p>
        <a href="" className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#121214] px-5 text-sm font-black text-white">
          <RefreshCw size={18} /> Повторить
        </a>
      </section>
    </main>
  );
}
