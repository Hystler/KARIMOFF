export default function AnalyticsLoading() {
  return (
    <main className="admin-content admin-content-wide analytics-page" aria-busy="true">
      <div className="analytics-skeleton h-28 w-full max-w-2xl" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 6 }, (_, index) => <div className="analytics-skeleton h-44" key={index} />)}
      </div>
      <div className="analytics-skeleton mt-6 h-[420px]" />
    </main>
  );
}
