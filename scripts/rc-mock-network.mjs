// Only loaded by the isolated local browser verification application.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return originalFetch(input, init);
  // No YooKassa, Telegram, MAX, Evotor or other external request can leave the fixture.
  throw new Error('RC_LOCAL_EXTERNAL_NETWORK_BLOCKED');
};
