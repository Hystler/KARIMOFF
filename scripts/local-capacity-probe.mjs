import { performance } from "node:perf_hooks";

// Intentionally restricted to an isolated local server. Never load-test production by accident.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3108");
if (base.hostname !== "127.0.0.1" || base.protocol !== "http:" || base.username || base.password || base.pathname !== "/" || base.search) {
  throw new Error("Use a loopback-only isolated fixture server, e.g. http://127.0.0.1:3108");
}
const paths = ["/", "/menu", "/login"];
const percentile = (values, p) => Math.round(values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]);
for (const path of paths) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000), redirect: "manual" });
  await response.arrayBuffer();
  if (response.status !== 200) throw new Error(`Warmup failed: ${path} ${response.status}`);
}
const sustained = process.argv.includes("--sustained");
for (const concurrency of sustained ? [20] : [1, 5, 10, 20]) {
  const latencies = [];
  const statusCounts = {};
  const requests = sustained ? 5000 : 120;
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < requests && (!sustained || performance.now() - start < 30000)) {
      const i = next++;
      const started = performance.now();
      let status = "network_error";
      try {
        const response = await fetch(new URL(paths[i % paths.length], base), { signal: AbortSignal.timeout(10000), redirect: "manual" });
        await response.arrayBuffer();
        status = String(response.status);
      } catch { /* Only aggregate errors; URLs, headers and response bodies are not logged. */ }
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      latencies.push(performance.now() - started);
    }
  }));
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ concurrency, requests: next, seconds: +( (performance.now() - start) / 1000).toFixed(2),
    requestsPerSecond: +(next / ((performance.now() - start) / 1000)).toFixed(1),
    p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), maxMs: Math.round(latencies.at(-1)), statusCounts }));
  if (statusCounts["200"] !== next) { process.exitCode = 1; break; }
}
