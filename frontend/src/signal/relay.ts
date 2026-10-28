// Client transport from the Signal SDK to the BYTE TALKS backend (our own relay).
// It carries only public keys and routing info. Private keys and plaintext never leave the device.
// Self-contained (no app imports) so the Node integration test can reuse it.

export type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<T>;

const EMPTY_INVENTORY = { ecSignedPreKey: null, kemLastResortPreKey: null, ecOneTimePreKeyCount: 0, kemOneTimePreKeyCount: 0 };

export function makeRelay(call: Call, platform: string, onDevice: (id: string) => void) {
  const inventory = () => call<any>("GET", "/signal/inventory").catch(() => EMPTY_INVENTORY);
  const upload = (keys: unknown[]) => call("POST", "/signal/prekeys", { keys });
  const impl: Record<string, any> = {
    relayConnectionState: "stopped",
    subscribeRelayConnectionState: () => () => {},
    subscribe: () => () => {}, // delivery runs through the app's message API, not a relay socket
    markDelivered: async () => {},
    getPreKeyInventory: () => inventory(),
    async provisionIdentityKey(req: any) {
      const r = await call<{ device: string }>("POST", "/signal/identity", {
        deviceId: req.deviceId,
        identity: req.identity,
        registrationId: req.registrationId,
        identityType: req.identityType ?? "aci",
        platform,
      });
      onDevice(r.device);
    },
    async getIdentityKey(userId: string) {
      return (await call<any>("GET", `/signal/identity/${userId}`)).identity ?? null;
    },
    async getPreKeyCount(_u: string, _d: number, type: "ec" | "kem") {
      const inv = await inventory();
      return type === "kem" ? inv.kemOneTimePreKeyCount : inv.ecOneTimePreKeyCount;
    },
    uploadPreKeys: (_u: string, _d: number, keys: unknown[]) => upload(keys),
    async publishPlannedPreKeys(_u: string, _d: number, plan: (inv: any) => Promise<unknown[]>) {
      const keys = await plan(await inventory());
      if (keys.length) await upload(keys as unknown[]);
    },
    getEcSignedPreKeyMetadata: async () => (await inventory()).ecSignedPreKey,
    getKemLastResortPreKeyMetadata: async () => (await inventory()).kemLastResortPreKey,
    clearStaleKemPreKeys: () => call("POST", "/signal/prekeys/clear-kem"),
    async getDevices(userId: string) {
      const r = await call<any>("GET", `/signal/identity/${userId}`);
      return r.device ? [{ deviceId: 1, registered: true, linked: false, enabled: true }] : [];
    },
    async getActiveDevices(userId: string) {
      const r = await call<any>("GET", `/signal/identity/${userId}`);
      return r.device ? [{ userId, deviceId: 1 }] : [];
    },
    async fetchPreKeyBundle(userId: string) {
      return (await call<any>("POST", `/signal/bundle/${userId}`)).bundle ?? null;
    },
  };
  // Anything we don't support (groups, linking, sealed sender...) fails closed instead of silently succeeding.
  return new Proxy(impl, {
    get(t, p) {
      if (p in t) return t[p as string];
      if (p === "then" || typeof p === "symbol") return undefined;
      return () => Promise.reject(new Error(`Relay operation ${String(p)} is not supported`));
    },
  }) as any;
}
