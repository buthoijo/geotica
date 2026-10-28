import { connect } from "cloudflare:sockets";

// Variables
let serviceName = "";
let APP_DOMAIN = "";

let prxIP = "";
let cachedPrxList = [];

// IN-MEMORY CACHE STORAGE
let memoryProxyCache = {
  data: [],
  lastUpdated: 0,
  ttl: 10 * 60 * 1000
};

// Constant & Default Values
const horse = "dHJvamFu";
const flash = "dm1lc3M=";
const neko = "dmxlc3M=";
const v2 = "djJyYXk=";

const PORTS = [443, 80];
const PROTOCOLS = [atob(horse), atob(flash), atob(neko), "ss"];
const SUB_PAGE_URL = "https://foolvpn.web.id/nautica";

// Default Configs
const DEFAULT_CONFIG = {
  DNS_TYPE: "DOH",
  DOH_URL: "https://cloudflare-dns.com/dns-query",
  DNS_SERVER_ADDRESS: "1.1.1.1",
  DNS_SERVER_PORT: "53",
  UDP_MODE: "RELAY",
  UDP_RELAY_HOST: "wsudprelay.up.railway.app",
  UDP_RELAY_PORT: "443",
  KV_PRX_URL: "https://raw.githubusercontent.com/Ddfathu/nauticamod/refs/heads/main/proxy.json",
  PRX_BANK_URL: "https://raw.githubusercontent.com/Ddfathu/nauticamod/refs/heads/main/proxy.txt",
  REVERSE_PRX_TARGET: "",
  RAW_KV_JSON_DATA: "",
  RAW_KV_TXT_DATA: "",
  OUTBOUND_MODE: "FULL_PROXY",
  TCP_OPTIMIZE_MODE: "OFF",
  ZERO_COPY_MODE: "ON",
  EARLY_FLUSH_MODE: "ON",
  STREAM_BUFFER_MODE: "HIGH_THROUGHPUT",
  DNS_HISTORY: [
    { type: "DOH", label: "Cloudflare DoH", dohUrl: "https://cloudflare-dns.com/dns-query", isDefault: true },
    { type: "DOH", label: "Google DoH", dohUrl: "https://dns.google/dns-query", isDefault: true },
    { type: "DOH", label: "NextDNS DoH", dohUrl: "https://dns.nextdns.io/dns-query", isDefault: true },
    { type: "UDP", label: "Google DNS (8.8.8.8:53)", addr: "8.8.8.8", port: "53", isDefault: true },
    { type: "UDP", label: "Cloudflare DNS (1.1.1.1:53)", addr: "1.1.1.1", port: "53", isDefault: true }
  ],
  RELAY_HISTORY: [
    { label: "Railway WS Relay (wsudprelay.up.railway.app:443)", host: "wsudprelay.up.railway.app", port: "443", isDefault: true }
  ],
  PRX_BANK_HISTORY: [
    { label: "Ddfathu Proxy Bank TXT", url: "https://raw.githubusercontent.com/Ddfathu/nauticamod/refs/heads/main/proxy.txt", isDefault: true },
    { label: "Official FoolVPN Nautica TXT", url: "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/main/proxyList.txt", isDefault: true }
  ],
  KV_PRX_HISTORY: [
    { label: "Ddfathu Proxy JSON URL", url: "https://raw.githubusercontent.com/Ddfathu/nauticamod/refs/heads/main/proxy.json", isDefault: true },
    { label: "Official FoolVPN Nautica JSON", url: "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/main/kvProxyList.json", isDefault: true }
  ],
  CUSTOM_PRX_LIST: []
};

const CONVERTER_URL = "https://api.foolvpn.web.id/convert";
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// Encrypted Stream Constants
const SALT_A1 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgS2V5X0xlbmd0aA==");
const SALT_A2 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgTm9uY2VfTGVuZ3Ro");
const SALT_A3 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgS2V5");
const SALT_A4 = atob("Vk1lc3MgSGVhZGVyIEFFQUQgTm9uY2U=");
const SALT_B1 = atob("QUVBRCBSZXNwIEhlYWRlciBMZW4gSVY=");
const SALT_B2 = atob("QUVBRCBSZXNwIEhlYWRlciBMZW4gSVY=");
const SALT_B3 = atob("QUVBRCBSZXNwIEhlYWRlciBLZXk=");
const SALT_B4 = atob("QUVBRCBSZXNwIEhlYWRlciBJVg==");

const RELAY_MAGIC = new TextEncoder().encode("VLRLY004");
const RELAY_MODE_PACKET_UDP = 0x03;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x02;
const ATYP_IPV6 = 0x03;

function concatBytes(...parts) {
  let len = 0;
  for (const p of parts) if (p) len += p.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    if (p && p.byteLength) {
      out.set(new Uint8Array(p), off);
      off += p.byteLength;
    }
  }
  return out;
}

function parseRelayEndpoint(bytes, offset = 0) {
  const b = new Uint8Array(bytes);
  if (b.byteLength < offset + 3) return null;
  const port = (b[offset] << 8) | b[offset + 1];
  const atyp = b[offset + 2];
  let p = offset + 3;
  if (atyp === ATYP_IPV4) {
    if (b.byteLength < p + 4) return null;
    return { address: Array.from(b.subarray(p, p + 4)).join("."), port, addressType: atyp, next: p + 4 };
  }
  if (atyp === ATYP_DOMAIN) {
    if (b.byteLength < p + 1) return null;
    const len = b[p++];
    if (b.byteLength < p + len) return null;
    return { address: new TextDecoder("utf-8").decode(b.subarray(p, p + len)), port, addressType: atyp, next: p + len };
  }
  if (atyp === ATYP_IPV6) {
    if (b.byteLength < p + 16) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(((b[p + i] << 8) | b[p + i + 1]).toString(16));
    return { address: parts.join(":"), port, addressType: atyp, next: p + 16 };
  }
  return null;
}

function encodeRelayEndpoint(address, port) {
  const p = Number(port);
  const head = new Uint8Array([(p >>> 8) & 0xff, p & 0xff]);
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(address))) {
    const ipBytes = new Uint8Array(String(address).split(".").map(Number));
    const out = new Uint8Array(head.length + 1 + ipBytes.length);
    out.set(head, 0);
    out[head.length] = ATYP_IPV4;
    out.set(ipBytes, head.length + 1);
    return out;
  }
  if (String(address).includes(":")) {
    const parts = String(address).split(":");
    const out = new Uint8Array(head.length + 1 + 16);
    out.set(head, 0);
    out[head.length] = ATYP_IPV6;
    for (let i = 0; i < 8; i++) {
      const val = parseInt(parts[i] || "0", 16);
      out[head.length + 1 + (i * 2)] = (val >>> 8) & 0xff;
      out[head.length + 1 + (i * 2) + 1] = val & 0xff;
    }
    return out;
  }
  const d = new TextEncoder().encode(String(address));
  const out = new Uint8Array(head.length + 2 + d.length);
  out.set(head, 0);
  out[head.length] = ATYP_DOMAIN;
  out[head.length + 1] = d.length;
  out.set(d, head.length + 2);
  return out;
}

function parseSocksAddress(bytes, cursor = 0) {
  const b = new Uint8Array(bytes);
  if (b.byteLength < cursor + 1) return null;
  const atyp = b[cursor++];
  let address = "";
  if (atyp === 0x01) {
    if (b.byteLength < cursor + 6) return null;
    address = Array.from(b.subarray(cursor, cursor + 4)).join(".");
    cursor += 4;
  } else if (atyp === 0x03) {
    if (b.byteLength < cursor + 1) return null;
    const len = b[cursor++];
    if (!len || b.byteLength < cursor + len + 2) return null;
    address = new TextDecoder("utf-8").decode(b.subarray(cursor, cursor + len));
    cursor += len;
  } else if (atyp === 0x04) {
    if (b.byteLength < cursor + 18) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(((b[cursor + i] << 8) | b[cursor + i + 1]).toString(16));
    address = parts.join(":");
    cursor += 16;
  } else return null;

  const port = (b[cursor] << 8) | b[cursor + 1];
  cursor += 2;
  return { address, port, addressType: atyp, next: cursor };
}

function encodeSocksAddress(endpoint) {
  const address = endpoint.address;
  const port = Number(endpoint.port);
  let addr;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(address))) {
    addr = concatBytes(new Uint8Array([0x01]), new Uint8Array(String(address).split(".").map(Number)));
  } else if (String(address).includes(":")) {
    const parts = String(address).split(":");
    const b = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
      const val = parseInt(parts[i] || "0", 16);
      b[i * 2] = (val >>> 8) & 0xff;
      b[i * 2 + 1] = val & 0xff;
    }
    addr = concatBytes(new Uint8Array([0x04]), b);
  } else {
    const d = new TextEncoder().encode(String(address));
    addr = concatBytes(new Uint8Array([0x03, d.byteLength]), d);
  }
  return concatBytes(addr, new Uint8Array([(port >>> 8) & 0xff, port & 0xff]));
}

function encodeTrojanUdpPacket(endpoint, payload) {
  const p = new Uint8Array(payload);
  return concatBytes(
    encodeSocksAddress(endpoint),
    new Uint8Array([(p.byteLength >>> 8) & 0xff, p.byteLength & 0xff, 0x0d, 0x0a]),
    p
  );
}

function parseProxy(proxyStr) {
  if (!proxyStr) return null;
  const atSplit = proxyStr.split("@");
  const hostPort = atSplit[0];
  const auth = atSplit[1] || null;

  let [host, port] = hostPort.split(":");
  port = parseInt(port, 10) || 443;

  let user = null;
  let pass = null;
  if (auth && auth.includes(":")) {
    const authParts = auth.split(":");
    user = authParts[0];
    pass = authParts.slice(1).join(":");
  }

  return { host, port, user, pass };
}

async function getConfig(env) {
  let kvConfig = {};
  if (env && env.CONFIG_KV) {
    try {
      const stored = await env.CONFIG_KV.get("APP_CONFIG", { type: "json" });
      if (stored) kvConfig = stored;
    } catch (e) {}
  }

  return {
    DNS_TYPE: kvConfig.DNS_TYPE || (env && env.DNS_TYPE) || DEFAULT_CONFIG.DNS_TYPE,
    DOH_URL: kvConfig.DOH_URL || (env && env.DOH_URL) || DEFAULT_CONFIG.DOH_URL,
    DNS_SERVER_ADDRESS: kvConfig.DNS_SERVER_ADDRESS || (env && env.DNS_SERVER_ADDRESS) || DEFAULT_CONFIG.DNS_SERVER_ADDRESS,
    DNS_SERVER_PORT: parseInt(kvConfig.DNS_SERVER_PORT || (env && env.DNS_SERVER_PORT) || DEFAULT_CONFIG.DNS_SERVER_PORT),
    UDP_MODE: kvConfig.UDP_MODE || (env && env.UDP_MODE) || DEFAULT_CONFIG.UDP_MODE,
    UDP_RELAY_HOST: kvConfig.UDP_RELAY_HOST || (env && env.UDP_RELAY_HOST) || DEFAULT_CONFIG.UDP_RELAY_HOST,
    UDP_RELAY_PORT: parseInt(kvConfig.UDP_RELAY_PORT || (env && env.UDP_RELAY_PORT) || DEFAULT_CONFIG.UDP_RELAY_PORT),
    KV_PRX_URL: kvConfig.KV_PRX_URL || (env && env.KV_PRX_URL) || DEFAULT_CONFIG.KV_PRX_URL,
    PRX_BANK_URL: kvConfig.PRX_BANK_URL || (env && env.PRX_BANK_URL) || DEFAULT_CONFIG.PRX_BANK_URL,
    REVERSE_PRX_TARGET: kvConfig.REVERSE_PRX_TARGET !== undefined ? kvConfig.REVERSE_PRX_TARGET : DEFAULT_CONFIG.REVERSE_PRX_TARGET,
    RAW_KV_JSON_DATA: kvConfig.RAW_KV_JSON_DATA !== undefined ? kvConfig.RAW_KV_JSON_DATA : DEFAULT_CONFIG.RAW_KV_JSON_DATA,
    RAW_KV_TXT_DATA: kvConfig.RAW_KV_TXT_DATA !== undefined ? kvConfig.RAW_KV_TXT_DATA : DEFAULT_CONFIG.RAW_KV_TXT_DATA,
    OUTBOUND_MODE: kvConfig.OUTBOUND_MODE || DEFAULT_CONFIG.OUTBOUND_MODE,
    TCP_OPTIMIZE_MODE: kvConfig.TCP_OPTIMIZE_MODE !== undefined ? kvConfig.TCP_OPTIMIZE_MODE : DEFAULT_CONFIG.TCP_OPTIMIZE_MODE,
    ZERO_COPY_MODE: kvConfig.ZERO_COPY_MODE !== undefined ? kvConfig.ZERO_COPY_MODE : DEFAULT_CONFIG.ZERO_COPY_MODE,
    EARLY_FLUSH_MODE: kvConfig.EARLY_FLUSH_MODE !== undefined ? kvConfig.EARLY_FLUSH_MODE : DEFAULT_CONFIG.EARLY_FLUSH_MODE,
    STREAM_BUFFER_MODE: kvConfig.STREAM_BUFFER_MODE !== undefined ? kvConfig.STREAM_BUFFER_MODE : DEFAULT_CONFIG.STREAM_BUFFER_MODE,
    DNS_HISTORY: kvConfig.DNS_HISTORY || DEFAULT_CONFIG.DNS_HISTORY,
    RELAY_HISTORY: kvConfig.RELAY_HISTORY || DEFAULT_CONFIG.RELAY_HISTORY,
    PRX_BANK_HISTORY: kvConfig.PRX_BANK_HISTORY || DEFAULT_CONFIG.PRX_BANK_HISTORY,
    KV_PRX_HISTORY: kvConfig.KV_PRX_HISTORY || DEFAULT_CONFIG.KV_PRX_HISTORY,
    CUSTOM_PRX_LIST: kvConfig.CUSTOM_PRX_LIST || DEFAULT_CONFIG.CUSTOM_PRX_LIST
  };
}

async function getKVPrxList(config) {
  if (config.RAW_KV_JSON_DATA && config.RAW_KV_JSON_DATA.trim() !== "") {
    try {
      return JSON.parse(config.RAW_KV_JSON_DATA);
    } catch (e) {}
  }
  if (!config.KV_PRX_URL) return {};
  try {
    const kvPrx = await fetch(config.KV_PRX_URL);
    return kvPrx.status == 200 ? await kvPrx.json() : {};
  } catch (e) {
    return {};
  }
}

async function getPrxList(config) {
  let kvParsedList = [];
  let urlParsedList = [];

  if (config.RAW_KV_TXT_DATA && config.RAW_KV_TXT_DATA.trim() !== "") {
    const lines = config.RAW_KV_TXT_DATA.split("\n").filter(Boolean);
    kvParsedList = lines.map((entry) => {
      const [prxIP, prxPort, country, org] = entry.split(",");
      return {
        prxIP: prxIP ? prxIP.trim() : "Unknown",
        prxPort: prxPort ? prxPort.trim() : "Unknown",
        country: country ? country.trim().toUpperCase() : "Unknown",
        org: org ? org.trim() : "Unknown Org",
      };
    }).filter(Boolean);
  }

  if (config.PRX_BANK_URL) {
    try {
      const prxBank = await fetch(config.PRX_BANK_URL);
      if (prxBank.status == 200) {
        const text = (await prxBank.text()) || "";
        const prxString = text.split("\n").filter(Boolean);
        urlParsedList = prxString.map((entry) => {
          const [prxIP, prxPort, country, org] = entry.split(",");
          return {
            prxIP: prxIP ? prxIP.trim() : "Unknown",
            prxPort: prxPort ? prxPort.trim() : "Unknown",
            country: country ? country.trim().toUpperCase() : "Unknown",
            org: org ? org.trim() : "Unknown Org",
          };
        }).filter(Boolean);
      }
    } catch (e) {}
  }

  let customList = config.CUSTOM_PRX_LIST || [];
  const existingIdentifiers = new Set([
    ...kvParsedList.map(p => `${p.prxIP}:${p.prxPort}`),
    ...customList.map(p => `${p.prxIP}:${p.prxPort}`)
  ]);

  const filteredUrlList = urlParsedList.filter(p => !existingIdentifiers.has(`${p.prxIP}:${p.prxPort}`));
  cachedPrxList = [...customList, ...kvParsedList, ...filteredUrlList];
  return cachedPrxList;
}

async function checkProxyInternal(host, port, timeoutMs = 800) {
  const startTime = Date.now();
  try {
    const socket = connect({ hostname: host, port: parseInt(port) || 443 });
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
    const latency = Date.now() - startTime;
    try { socket.close(); } catch (e) {}
    return { status: "active", latency: latency };
  } catch (err) {
    return { status: "dead", latency: 99999 };
  }
}

async function getBestInMemoryProxy(config) {
  const now = Date.now();
  if (memoryProxyCache.data.length > 0 && (now - memoryProxyCache.lastUpdated < memoryProxyCache.ttl)) {
    const randomCached = memoryProxyCache.data[Math.floor(Math.random() * memoryProxyCache.data.length)];
    return `${randomCached.prxIP}:${randomCached.prxPort}`;
  }

  const list = await getPrxList(config);
  if (list.length === 0) return "66.33.22.238:27436";

  const prioritized = list.filter(p => p.country === "SG" || p.country === "ID");
  const targetPool = prioritized.length > 0 ? prioritized : list;

  const samples = targetPool.sort(() => 0.5 - Math.random()).slice(0, 6);
  const testResults = await Promise.all(
    samples.map(async (p) => {
      const res = await checkProxyInternal(p.prxIP, parseInt(p.prxPort) || 443, 600);
      return { ...p, latency: res.latency };
    })
  );

  testResults.sort((a, b) => a.latency - b.latency);
  const healthyOnly = testResults.filter(p => p.latency < 400);

  if (healthyOnly.length > 0) {
    memoryProxyCache.data = healthyOnly;
    memoryProxyCache.lastUpdated = now;
    return `${healthyOnly[0].prxIP}:${healthyOnly[0].prxPort}`;
  }

  const activeOnly = testResults.filter(p => p.latency < 99999);
  if (activeOnly.length > 0) {
    memoryProxyCache.data = activeOnly;
    memoryProxyCache.lastUpdated = now;
    return `${activeOnly[0].prxIP}:${activeOnly[0].prxPort}`;
  }

  return `${samples[0].prxIP}:${samples[0].prxPort}`;
}

async function getBestSgProxyInternal(config) {
  try {
    const kvPrx = await getKVPrxList(config);
    if (kvPrx && kvPrx["SG"] && Array.isArray(kvPrx["SG"]) && kvPrx["SG"].length > 0) {
      const sgPool = kvPrx["SG"];
      return sgPool[Math.floor(Math.random() * sgPool.length)];
    }
  } catch (e) {}

  const list = await getPrxList(config);
  const sgList = list.filter(p => p.country && p.country.toUpperCase() === "SG");
  const targetList = sgList.length > 0 ? sgList : list;

  if (targetList.length === 0) return "66.33.22.238:27436";
  return `${targetList[0].prxIP}:${targetList[0].prxPort}`;
}

async function getProxyByCountry(config, countryCode) {
  const cc = countryCode.toUpperCase();
  try {
    const kvPrx = await getKVPrxList(config);
    if (kvPrx && Array.isArray(kvPrx[cc]) && kvPrx[cc].length > 0) {
      const pool = kvPrx[cc];
      return pool[Math.floor(Math.random() * pool.length)];
    }
  } catch (e) {}

  const list = await getPrxList(config);
  const matched = list.filter(p => (p.country || "").toUpperCase() === cc);
  if (matched.length > 0) {
    const chosen = matched[Math.floor(Math.random() * matched.length)];
    return `${chosen.prxIP}:${chosen.prxPort}`;
  }

  return await getBestInMemoryProxy(config);
}

function getDashboardHtml(currentConfig) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Nautica Worker Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #000000; color: #00ffcc; padding: 16px; margin: 0; display: flex; justify-content: center; }
    .card { background-color: #050505; padding: 20px; border-radius: 12px; width: 100%; max-width: 500px; box-shadow: 0 0 25px rgba(0, 255, 204, 0.2); border: 1px solid #00ffcc; position: relative; }
    .header-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .menu-btn { font-size: 1.4rem; background: none; border: 1px solid #00ffcc; color: #00ffcc; border-radius: 6px; padding: 4px 10px; cursor: pointer; line-height: 1; }
    .menu-btn:hover { background: #00ffcc; color: #000000; }
    h2 { margin: 0; color: #00ffff; font-size: 1.1rem; text-align: center; text-shadow: 0 0 10px rgba(0, 255, 255, 0.8); flex-grow: 1; }
    .sidebar-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.75); display: none; z-index: 998; backdrop-filter: blur(2px); }
    .sidebar { position: fixed; top: 0; left: -290px; width: 270px; height: 100%; background: #050505; border-right: 1px solid #00ffcc; box-shadow: 5px 0 25px rgba(0, 255, 204, 0.3); z-index: 999; transition: left 0.3s ease; padding: 20px 14px; box-sizing: border-box; }
    .sidebar.open { left: 0; }
    .sidebar h3 { margin-top: 0; color: #00ffff; font-size: 1.05rem; border-bottom: 1px dashed #00ffcc; padding-bottom: 8px; }
    .side-item { display: block; width: 100%; text-align: left; padding: 12px; margin: 10px 0; background: #000000; border: 1px solid #00ffcc; border-radius: 6px; color: #00ffcc; font-size: 0.9rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .side-item:hover, .side-item.active { background: #00ffcc; color: #000000; font-weight: bold; }
    .close-btn { float: right; background: none; border: none; color: #ff073a; font-size: 1.2rem; font-weight: bold; cursor: pointer; }
    h3 { color: #39ff14; font-size: 0.95rem; margin-top: 16px; margin-bottom: 6px; border-bottom: 1px dashed #39ff14; padding-bottom: 4px; text-shadow: 0 0 8px rgba(57, 255, 20, 0.6); }
    label { font-size: 0.8rem; font-weight: 600; color: #00ffcc; display: block; margin-top: 10px; margin-bottom: 4px; }
    input, select { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #00ffcc; background: #000000; color: #ffffff; box-sizing: border-box; font-size: 0.85rem; font-family: monospace; }
    textarea { width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #00ffcc; background: #000000; color: #ffffff; box-sizing: border-box; font-size: 0.85rem; font-family: monospace; min-height: 120px; resize: vertical; }
    input:focus, select:focus, textarea:focus { outline: none; border-color: #39ff14; box-shadow: 0 0 10px rgba(57, 255, 20, 0.6); }
    .btn-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 6px; }
    .btn-mode { padding: 9px 4px; border: 1px solid #00ffff; border-radius: 6px; background: #000000; color: #00ffff; font-weight: bold; cursor: pointer; font-size: 0.75rem; transition: 0.2s; text-align: center; }
    .btn-mode:hover { background: #00ffff; color: #000000; }
    .btn-mode.rev { border-color: #ff073a; color: #ff073a; }
    .btn-mode.rev:hover { background: #ff073a; color: #000000; }
    .btn-mode.cdn { border-color: #bf00ff; color: #bf00ff; }
    .btn-mode.cdn:hover { background: #bf00ff; color: #000000; }
    .btn-gen { background-color: #000000; color: #39ff14; border: 1px solid #39ff14; width: 100%; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 10px; }
    .btn-gen:hover { background-color: #39ff14; color: #000000; }
    .btn-copy { background-color: #000000; padding: 6px 12px; border: 1px solid #00ffff; border-radius: 4px; color: #00ffff; font-size: 0.75rem; cursor: pointer; float: right; font-weight: bold; }
    .btn-copy:hover { background-color: #00ffff; color: #000000; }
    .btn-del { background-color: #000000; color: #ff073a; border: 1px solid #ff073a; padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; margin-top: 6px; display: inline-block; }
    .out-box { background: #000000; border: 1px solid #00ffcc; padding: 10px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.78rem; margin-top: 8px; color: #39ff14; user-select: all; }
    .custom-box { background: #000000; border: 1px dashed #00ffcc; padding: 10px; border-radius: 6px; margin-top: 8px; }
    .sub-panel { background: #0a0e17; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; margin-top: 14px; }
    .status-badge { display: flex; align-items: center; justify-content: center; gap: 8px; background-color: rgba(57, 255, 20, 0.08); border: 1px solid #39ff14; color: #39ff14; padding: 8px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; margin-bottom: 14px; }
    .pulse-dot { width: 8px; height: 8px; background-color: #39ff14; border-radius: 50%; box-shadow: 0 0 8px #39ff14; }
  </style>
</head>
<body>
  <div class="sidebar-overlay" id="overlay" onclick="closeSidebar()"></div>
  <div class="sidebar" id="sidebar">
    <button class="close-btn" onclick="closeSidebar()">✖</button>
    <h3>⚡ MENU NAVIGASI</h3>
    <button type="button" class="side-item active" onclick="switchNav('gen')">⚡ Generator VLESS</button>
    <button type="button" class="side-item" onclick="switchNav('add-prx')">➕ Add Proxy</button>
    <button type="button" class="side-item" onclick="switchNav('settings')">⚙️ Settings Terpisah (KV)</button>
  </div>

  <div class="card">
    <div class="header-bar">
      <button class="menu-btn" onclick="openSidebar()">☰</button>
      <h2>⚡ DDFATHUVLES ULTRA SPEED</h2>
      <div style="width:34px;"></div>
    </div>

    <div class="status-badge"><span class="pulse-dot"></span> Mode: ${currentConfig.OUTBOUND_MODE} (Multi-Bank & Dynamic CC Active)</div>

    <!-- TAB 1: GENERATOR -->
    <div id="tab-gen">
      <label>UUID / PASS:</label>
      <input type="text" id="gen_uuid" value="${crypto.randomUUID()}">

      <label>BUG HOST (SNI / CDN):</label>
      <input type="text" id="gen_bug" value="api.quipper.com">

      <label>PORT TARGET:</label>
      <select id="gen_port">
        <option value="443" selected>443 (TLS / HTTPS)</option>
        <option value="80">80 (NTLS / HTTP)</option>
        <option value="8080">8080 (NTLS Alternate)</option>
        <option value="8443">8443 (TLS Alternate)</option>
      </select>

      <label style="margin-top: 8px;">🔍 CARI / FILTER PROXY:</label>
      <input type="text" id="gen_search" style="text-transform: uppercase;" placeholder="Ketik ALL atau ID / SG / US..." oninput="this.value = this.value.toUpperCase(); filterProxyList()">

      <label style="margin-top: 8px;">PILIH TARGET PROXY IP / MODE:</label>
      <select id="gen_proxy_select" onchange="toggleCustomProxyInput()">
        <option value="MULTI" selected>🧠 /MULTI (Auto Pool SG/ID)</option>
        <option value="DIRECT">🚀 /DIRECT (Pure Direct Cloudflare)</option>
        <option value="SG">🇸🇬 /SG (Singapore Auto Pool)</option>
        <option value="ID">🇮🇩 /ID (Indonesia Auto Pool)</option>
        <option value="US">🇺🇸 /US (United States Auto Pool)</option>
        <option value="CUSTOM">✏️ Custom / Manual Proxy Input</option>
      </select>

      <div id="custom_proxy_field" style="display:none;">
        <label>Custom Proxy (IP:Port atau IP:Port@User:Pass):</label>
        <input type="text" id="gen_ip_custom" value="66.33.22.238:27436">
      </div>

      <h3>▌ BUG SNI (NORMAL / STANDAR)</h3>
      <div class="btn-grid">
        <button type="button" class="btn-mode" onclick="makeSingleConfig('VLESS_STD')">VLESS STD</button>
        <button type="button" class="btn-mode" onclick="makeSingleConfig('TROJAN_STD')">TROJAN STD</button>
        <button type="button" class="btn-mode" onclick="makeSingleConfig('VMESS_STD')">VMESS STD</button>
      </div>

      <h3>▌ BUG SNI (REVERSE)</h3>
      <div class="btn-grid">
        <button type="button" class="btn-mode rev" onclick="makeSingleConfig('VLESS_REV')">VLESS REV</button>
        <button type="button" class="btn-mode rev" onclick="makeSingleConfig('TROJAN_REV')">TROJAN REV</button>
        <button type="button" class="btn-mode rev" onclick="makeSingleConfig('VMESS_REV')">VMESS REV</button>
      </div>

      <h3>▌ BUG CDN (PROXY PORT)</h3>
      <div class="btn-grid">
        <button type="button" class="btn-mode cdn" onclick="makeSingleConfig('VLESS_CDN')">VLESS CDN</button>
        <button type="button" class="btn-mode cdn" onclick="makeSingleConfig('TROJAN_CDN')">TROJAN CDN</button>
        <button type="button" class="btn-mode cdn" onclick="makeSingleConfig('VMESS_CDN')">VMESS CDN</button>
      </div>

      <div id="gen_results" style="display:none; margin-top: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong id="result_title" style="font-size:0.85rem; color:#00ffff;">RESULT CONFIG:</strong>
          <button type="button" class="btn-copy" onclick="copyText('out_result')">[COPY]</button>
        </div>
        <div class="out-box" id="out_result"></div>
      </div>
    </div>

    <!-- TAB 2: ADD PROXY -->
    <div id="tab-add-prx" style="display: none;">
      <h3>➕ Daftarkan Custom Proxy Baru</h3>
      <form id="addProxyForm">
        <label>IP / Host Proxy:</label>
        <input type="text" id="new_prx_ip" placeholder="contoh: 66.33.22.238" required>

        <label>Port Proxy:</label>
        <input type="number" id="new_prx_port" placeholder="contoh: 27436" value="27436" required>

        <label>Kode Negara (CC):</label>
        <input type="text" id="new_prx_cc" style="text-transform: uppercase;" value="SG" required>

        <label>Nama ISP / Org / Label:</label>
        <input type="text" id="new_prx_org" value="Railway-Node">

        <button type="submit" class="btn-gen">💾 Simpan Proxy Baru Ke KV</button>
      </form>
    </div>

    <!-- TAB 3: SETTINGS KV -->
    <div id="tab-settings" style="display: none;">
      
      <!-- 1. KONTROL MODE ROUTING OUTBOUND -->
      <div class="sub-panel" style="border-color:#38bdf8;">
        <h3 style="margin-top:0; color:#38bdf8;">🔀 1. Mode Routing Outbound</h3>
        <label>Pilih Mode Kerja Path / Proxy:</label>
        <select id="set_outbound_mode">
          <option value="FULL_PROXY" ${currentConfig.OUTBOUND_MODE === 'FULL_PROXY' ? 'selected' : ''}>🛡️ FULL PROXY (100% dipaksa ke proxy IP:Port via CONNECT)</option>
          <option value="SMART_FALLBACK" ${currentConfig.OUTBOUND_MODE === 'SMART_FALLBACK' ? 'selected' : ''}>🧠 SMART FALLBACK (Direct dulu non-CF, fallback ke proxy)</option>
          <option value="PURE_DIRECT" ${currentConfig.OUTBOUND_MODE === 'PURE_DIRECT' ? 'selected' : ''}>⚡ PURE DIRECT (Semua web direct murni)</option>
        </select>
        <button type="button" class="btn-gen" style="color:#38bdf8; border-color:#38bdf8;" onclick="saveOutboundModeOnly()">💾 SIMPAN MODE ROUTING SAJA</button>
      </div>

      <!-- 2. SPEED TUNING / OPTIMASI -->
      <div class="sub-panel">
        <h3 style="margin-top:0;">🚀 2. Fitur Speed & Zero-Copy</h3>
        <label>Mode Zero-Copy:</label>
        <select id="set_zero_copy">
          <option value="ON" ${currentConfig.ZERO_COPY_MODE === 'ON' ? 'selected' : ''}>🟢 ON (Aktif)</option>
          <option value="OFF" ${currentConfig.ZERO_COPY_MODE === 'OFF' ? 'selected' : ''}>🔴 OFF</option>
        </select>

        <label style="margin-top: 8px;">Early-Socket Flush:</label>
        <select id="set_early_flush">
          <option value="ON" ${currentConfig.EARLY_FLUSH_MODE === 'ON' ? 'selected' : ''}>🟢 ON (Instan)</option>
          <option value="OFF" ${currentConfig.EARLY_FLUSH_MODE === 'OFF' ? 'selected' : ''}>🔴 OFF</option>
        </select>

        <label style="margin-top: 8px;">Buffer Window Mode:</label>
        <select id="set_buffer_mode">
          <option value="HIGH_THROUGHPUT" ${currentConfig.STREAM_BUFFER_MODE === 'HIGH_THROUGHPUT' ? 'selected' : ''}>🚀 High-Throughput</option>
          <option value="LOW_LATENCY" ${currentConfig.STREAM_BUFFER_MODE === 'LOW_LATENCY' ? 'selected' : ''}>⚡ Low-Latency</option>
        </select>
        <button type="button" class="btn-gen" onclick="saveSpeedOnly()">💾 SIMPAN PENGATURAN SPEED SAJA</button>
      </div>

      <!-- 3. UDP HANDLING & RELAY URL / PORT -->
      <div class="sub-panel" style="border-color:#39ff14;">
        <h3 style="margin-top:0; color:#39ff14;">📡 3. Pengubah UDP Relay Server & Mode</h3>
        <label>Mode UDP Routing:</label>
        <select id="set_udp_mode" onchange="toggleRelayDisplayUI()">
          <option value="RELAY" ${currentConfig.UDP_MODE === 'RELAY' ? 'selected' : ''}>UDP WebSocket Relay (Railway / VLRLY004)</option>
          <option value="NATIVE" ${currentConfig.UDP_MODE === 'NATIVE' ? 'selected' : ''}>Native Outbound Direct</option>
        </select>

        <div id="relay_wrapper_ui">
          <label style="margin-top:8px;">Pilih Preset UDP Relay dari KV:</label>
          <select id="relay_select" onchange="handleRelaySelectChange()">
            <option value="DEFAULT_SCRIPT">⚙️ Default Script (wsudprelay.up.railway.app:443)</option>
          </select>
          <button type="button" id="btn_delete_relay" class="btn-del" style="display:none;" onclick="deleteSelectedRelay()">🗑️ Hapus Preset Ini</button>

          <div id="relay_custom_box" class="custom-box" style="display:none;">
            <label>UDP Relay Host (Domain Railway):</label>
            <input type="text" id="set_relay_host" value="${currentConfig.UDP_RELAY_HOST}">

            <label style="margin-top:6px;">UDP Relay Port (Wajib 443):</label>
            <input type="number" id="set_relay_port" value="${currentConfig.UDP_RELAY_PORT}">
          </div>
        </div>
        <button type="button" class="btn-gen" style="color:#39ff14; border-color:#39ff14;" onclick="saveRelayOnly()">💾 SIMPAN UDP RELAY SETTINGS SAJA</button>
      </div>

      <!-- 4. PROXY BANK TXT, JSON KV & REVERSE TARGET -->
      <div class="sub-panel" style="border-color:#a855f7;">
        <h3 style="margin-top:0; color:#c084fc;">🔗 4. URL Bank TXT, JSON & Reverse Web</h3>
        
        <label>Proxy Bank TXT URL:</label>
        <select id="prx_bank_select" onchange="handlePrxBankSelectChange()">
          <option value="DEFAULT_SCRIPT">⚙️ Default Script (Reset ke Default URL)</option>
        </select>
        <button type="button" id="btn_delete_prx_bank" class="btn-del" style="display:none;" onclick="deleteSelectedPrxBank()">🗑️ Hapus Preset Ini</button>
        <div id="prx_bank_custom_box" class="custom-box" style="display: none;">
          <input type="url" id="set_prx_bank_url" value="${currentConfig.PRX_BANK_URL}">
        </div>

        <label style="margin-top: 10px;">KV Proxy List JSON URL:</label>
        <select id="kv_prx_select" onchange="handleKvPrxSelectChange()">
          <option value="DEFAULT_SCRIPT">⚙️ Default Script (Reset ke Default JSON)</option>
        </select>
        <button type="button" id="btn_delete_kv_prx" class="btn-del" style="display:none;" onclick="deleteSelectedKvPrx()">🗑️ Hapus Preset Ini</button>
        <div id="kv_prx_custom_box" class="custom-box" style="display: none;">
          <input type="url" id="set_kv_prx_url" value="${currentConfig.KV_PRX_URL}">
        </div>

        <label style="margin-top: 10px;">Reverse Proxy Target Domain:</label>
        <input type="text" id="set_reverse_target" value="${currentConfig.REVERSE_PRX_TARGET || ''}" placeholder="contoh: google.com (Kosongkan jika ingin UI muncul)">

        <button type="button" class="btn-gen" style="color:#c084fc; border-color:#c084fc;" onclick="saveUrlsOnly()">💾 SIMPAN URL BANK & DOMAIN SAJA</button>
      </div>

      <!-- 5. RAW KV DATA -->
      <div class="sub-panel">
        <h3 style="margin-top:0;">📦 5. Data Raw KV (JSON & TXT)</h3>
        <label>Raw JSON Proxy List:</label>
        <textarea id="set_raw_json" placeholder='{"ID": ["172.232.249.224:2053"]}'>${currentConfig.RAW_KV_JSON_DATA || ''}</textarea>

        <label style="margin-top: 8px;">Raw TXT Proxy Bank:</label>
        <textarea id="set_raw_txt" placeholder="152.32.181.246,44070,AE,UCLOUD">${currentConfig.RAW_KV_TXT_DATA || ''}</textarea>

        <button type="button" class="btn-gen" onclick="saveRawDataOnly()">💾 SIMPAN RAW DATA SAJA</button>
      </div>

    </div>
  </div>

  <script>
    var rawHost = window.location.hostname || "${APP_DOMAIN}";
    var currentWorkerHost = rawHost.split(':')[0].trim();
    
    var rawProxyList = [];
    var currentConfig = ${JSON.stringify(currentConfig)};

    var DEFAULT_SCRIPT_PRX_BANK = "https://raw.githubusercontent.com/Ddfathu/nauticamod/refs/heads/main/proxy.txt";
    var DEFAULT_SCRIPT_KV_PRX = "https://raw.githubusercontent.com/Ddfathu/nauticamod/refs/heads/main/proxy.json";
    var DEFAULT_SCRIPT_RELAY = { host: "wsudprelay.up.railway.app", port: "443" };

    window.addEventListener('DOMContentLoaded', function() {
      renderPrxBankOptions();
      renderKvPrxOptions();
      renderRelayOptions();
      toggleRelayDisplayUI();
      loadProxyList();
    });

    function openSidebar() {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('overlay').style.display = 'block';
    }

    function closeSidebar() {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('overlay').style.display = 'none';
    }

    function switchNav(tab) {
      document.getElementById('tab-gen').style.display = tab === 'gen' ? 'block' : 'none';
      document.getElementById('tab-add-prx').style.display = tab === 'add-prx' ? 'block' : 'none';
      document.getElementById('tab-settings').style.display = tab === 'settings' ? 'block' : 'none';
      
      var btns = document.querySelectorAll('.side-item');
      btns[0].classList.toggle('active', tab === 'gen');
      btns[1].classList.toggle('active', tab === 'add-prx');
      btns[2].classList.toggle('active', tab === 'settings');
      closeSidebar();
    }

    function renderRelayOptions() {
      var select = document.getElementById('relay_select');
      if (!select) return;
      select.innerHTML = '<option value="DEFAULT_SCRIPT">⚙️ Default Script (wsudprelay.up.railway.app:443)</option>';

      (currentConfig.RELAY_HISTORY || []).forEach(function(item, index) {
        var opt = document.createElement('option');
        opt.value = index;
        opt.innerText = item.label;
        if (item.host === currentConfig.UDP_RELAY_HOST && item.port == currentConfig.UDP_RELAY_PORT) opt.selected = true;
        select.appendChild(opt);
      });

      var customOpt = document.createElement('option');
      customOpt.value = 'CUSTOM';
      customOpt.innerText = '✏️ Custom Input Relay Baru...';
      select.appendChild(customOpt);
      handleRelaySelectChange();
    }

    function handleRelaySelectChange() {
      var val = document.getElementById('relay_select').value;
      var customBox = document.getElementById('relay_custom_box');
      var delBtn = document.getElementById('btn_delete_relay');

      if (val === 'DEFAULT_SCRIPT') {
        customBox.style.display = 'none';
        delBtn.style.display = 'none';
        document.getElementById('set_relay_host').value = DEFAULT_SCRIPT_RELAY.host;
        document.getElementById('set_relay_port').value = DEFAULT_SCRIPT_RELAY.port;
      } else if (val === 'CUSTOM') {
        customBox.style.display = 'block';
        delBtn.style.display = 'none';
      } else {
        customBox.style.display = 'none';
        var item = currentConfig.RELAY_HISTORY[parseInt(val)];
        document.getElementById('set_relay_host').value = item.host;
        document.getElementById('set_relay_port').value = item.port;
        delBtn.style.display = item.isDefault ? 'none' : 'inline-block';
      }
    }

    function toggleRelayDisplayUI() {
      var mode = document.getElementById('set_udp_mode').value;
      document.getElementById('relay_wrapper_ui').style.display = (mode === 'RELAY') ? 'block' : 'none';
    }

    async function deleteSelectedRelay() {
      var val = document.getElementById('relay_select').value;
      if (val === 'CUSTOM' || val === 'DEFAULT_SCRIPT') return;
      if (confirm('Hapus preset UDP Relay ini dari KV?')) {
        currentConfig.RELAY_HISTORY.splice(parseInt(val), 1);
        await savePartialToKV({ RELAY_HISTORY: currentConfig.RELAY_HISTORY });
      }
    }

    function renderPrxBankOptions() {
      var select = document.getElementById('prx_bank_select');
      if (!select) return;
      select.innerHTML = '<option value="DEFAULT_SCRIPT">⚙️ Default Script (Reset ke Default URL)</option>';

      (currentConfig.PRX_BANK_HISTORY || []).forEach(function(item, index) {
        var opt = document.createElement('option');
        opt.value = index;
        opt.innerText = item.label;
        if (item.url === currentConfig.PRX_BANK_URL) opt.selected = true;
        select.appendChild(opt);
      });

      var customOpt = document.createElement('option');
      customOpt.value = 'CUSTOM';
      customOpt.innerText = '✏️ Custom URL Proxy Bank Baru...';
      select.appendChild(customOpt);
      handlePrxBankSelectChange();
    }

    function handlePrxBankSelectChange() {
      var val = document.getElementById('prx_bank_select').value;
      var customBox = document.getElementById('prx_bank_custom_box');
      var delBtn = document.getElementById('btn_delete_prx_bank');

      if (val === 'DEFAULT_SCRIPT') {
        customBox.style.display = 'none';
        delBtn.style.display = 'none';
        document.getElementById('set_prx_bank_url').value = DEFAULT_SCRIPT_PRX_BANK;
      } else if (val === 'CUSTOM') {
        customBox.style.display = 'block';
        delBtn.style.display = 'none';
      } else {
        customBox.style.display = 'none';
        var item = currentConfig.PRX_BANK_HISTORY[parseInt(val)];
        document.getElementById('set_prx_bank_url').value = item.url;
        delBtn.style.display = item.isDefault ? 'none' : 'inline-block';
      }
    }

    async function deleteSelectedPrxBank() {
      var val = document.getElementById('prx_bank_select').value;
      if (val === 'CUSTOM' || val === 'DEFAULT_SCRIPT') return;
      if (confirm('Hapus preset Proxy Bank URL ini dari KV?')) {
        currentConfig.PRX_BANK_HISTORY.splice(parseInt(val), 1);
        await savePartialToKV({ PRX_BANK_HISTORY: currentConfig.PRX_BANK_HISTORY });
      }
    }

    function renderKvPrxOptions() {
      var select = document.getElementById('kv_prx_select');
      if (!select) return;
      select.innerHTML = '<option value="DEFAULT_SCRIPT">⚙️ Default Script (Reset ke Default JSON)</option>';

      (currentConfig.KV_PRX_HISTORY || []).forEach(function(item, index) {
        var opt = document.createElement('option');
        opt.value = index;
        opt.innerText = item.label;
        if (item.url === currentConfig.KV_PRX_URL) opt.selected = true;
        select.appendChild(opt);
      });

      var customOpt = document.createElement('option');
      customOpt.value = 'CUSTOM';
      customOpt.innerText = '✏️ Custom URL KV Proxy JSON Baru...';
      select.appendChild(customOpt);
      handleKvPrxSelectChange();
    }

    function handleKvPrxSelectChange() {
      var val = document.getElementById('kv_prx_select').value;
      var customBox = document.getElementById('kv_prx_custom_box');
      var delBtn = document.getElementById('btn_delete_kv_prx');

      if (val === 'DEFAULT_SCRIPT') {
        customBox.style.display = 'none';
        delBtn.style.display = 'none';
        document.getElementById('set_kv_prx_url').value = DEFAULT_SCRIPT_KV_PRX;
      } else if (val === 'CUSTOM') {
        customBox.style.display = 'block';
        delBtn.style.display = 'none';
      } else {
        customBox.style.display = 'none';
        var item = currentConfig.KV_PRX_HISTORY[parseInt(val)];
        document.getElementById('set_kv_prx_url').value = item.url;
        delBtn.style.display = item.isDefault ? 'none' : 'inline-block';
      }
    }

    async function deleteSelectedKvPrx() {
      var val = document.getElementById('kv_prx_select').value;
      if (val === 'CUSTOM' || val === 'DEFAULT_SCRIPT') return;
      if (confirm('Hapus preset KV Proxy JSON URL ini dari KV?')) {
        currentConfig.KV_PRX_HISTORY.splice(parseInt(val), 1);
        await savePartialToKV({ KV_PRX_HISTORY: currentConfig.KV_PRX_HISTORY });
      }
    }

    async function loadProxyList() {
      try {
        var res = await fetch('/api/get-proxy-list');
        rawProxyList = await res.json();
        renderProxyOptions(rawProxyList);
      } catch (e) {}
    }

    function renderProxyOptions(list) {
      var select = document.getElementById('gen_proxy_select');
      if (!select) return;
      
      var currentVal = select.value;
      select.innerHTML = '<option value="MULTI">🧠 /MULTI (Auto Pool SG/ID)</option>' +
                         '<option value="DIRECT">🚀 /DIRECT (Pure Direct Cloudflare)</option>' +
                         '<option value="SG">🇸🇬 /SG (Singapore Auto Pool)</option>' +
                         '<option value="ID">🇮🇩 /ID (Indonesia Auto Pool)</option>' +
                         '<option value="US">🇺🇸 /US (United States Auto Pool)</option>' +
                         '<option value="CUSTOM">✏️ Custom / Manual Proxy Input</option>';

      if (list && list.length > 0) {
        list.forEach(function(p) {
          var opt = document.createElement('option');
          opt.value = p.prxIP + ':' + p.prxPort;
          opt.innerText = '[' + p.country + '] ' + p.prxIP + ':' + p.prxPort + ' (' + p.org + ')';
          select.appendChild(opt);
        });
      }
      select.value = currentVal || "MULTI";
      toggleCustomProxyInput();
    }

    function filterProxyList() {
      var query = document.getElementById('gen_search').value.trim().toUpperCase();
      if (!query || query === 'ALL') {
        renderProxyOptions(rawProxyList);
        return;
      }
      var filtered = rawProxyList.filter(function(p) {
        var cc = (p.country || '').trim().toUpperCase();
        var ip = (p.prxIP || '').trim();
        var org = (p.org || '').trim().toUpperCase();
        return cc.indexOf(query) !== -1 || ip.indexOf(query) !== -1 || org.indexOf(query) !== -1;
      });
      renderProxyOptions(filtered);
    }

    function toggleCustomProxyInput() {
      var val = document.getElementById('gen_proxy_select').value;
      document.getElementById('custom_proxy_field').style.display = (val === 'CUSTOM') ? 'block' : 'none';
    }

    // GENERATOR STRING CONCAT BIASA (BEBAS SYNTAX ERROR)
    function makeSingleConfig(mode) {
      var bug = document.getElementById('gen_bug').value.trim();
      if (bug.indexOf(':') !== -1) bug = bug.split(':')[0];
      var selectedPort = document.getElementById('gen_port').value;
      var proxySelect = document.getElementById('gen_proxy_select').value;
      var proxy = (proxySelect === 'CUSTOM') ? document.getElementById('gen_ip_custom').value.trim() : proxySelect;

      if (!proxy) return alert('Silakan isi target proxy!');

      var uuid = document.getElementById('gen_uuid').value.trim();
      var pathStr = '/' + proxy;
      var isNTLS = (selectedPort === '80' || selectedPort === '8080');
      var secMode = isNTLS ? 'none' : 'tls';
      
      var tlsQuery = isNTLS ? '&security=none' : '&security=tls&sni=' + currentWorkerHost + '&fp=chrome';

      var finalLink = '';
      var titleText = '';

      if (mode === 'VLESS_STD') {
        titleText = 'DDFATHU-VLESS-SNI-WS (STD)';
        finalLink = 'vless://' + uuid + '@' + bug + ':' + selectedPort + '?encryption=none&type=ws&host=' + currentWorkerHost + '&path=' + encodeURIComponent(pathStr) + tlsQuery + '#' + encodeURIComponent('VLESS-' + proxy + '-' + bug);
      } else if (mode === 'TROJAN_STD') {
        titleText = 'DDFATHU-TROJAN-SNI-WS (STD)';
        finalLink = 'trojan://' + uuid + '@' + bug + ':' + selectedPort + '?type=ws&host=' + currentWorkerHost + '&path=' + encodeURIComponent(pathStr) + tlsQuery + '#' + encodeURIComponent('TROJAN-' + proxy + '-' + bug);
      } else if (mode === 'VMESS_STD') {
        titleText = 'DDFATHU-VMESS-SNI-WS (STD)';
        var vmessJson = {
          v: "2",
          ps: 'VMESS-' + proxy + '-' + bug,
          add: bug,
          port: selectedPort,
          id: uuid,
          aid: "0",
          scy: "zero",
          net: "ws",
          type: "none",
          host: currentWorkerHost,
          path: pathStr,
          tls: isNTLS ? "" : "tls",
          sni: isNTLS ? "" : currentWorkerHost,
          alpn: "",
          fp: isNTLS ? "" : "chrome"
        };
        finalLink = "vmess://" + btoa(unescape(encodeURIComponent(JSON.stringify(vmessJson))));
      } else if (mode === 'VLESS_REV') {
        titleText = 'DDFATHU-VLESS-SNI-WS (REV)';
        finalLink = 'vless://' + uuid + '@' + currentWorkerHost + ':' + selectedPort + '?encryption=none&type=ws&host=' + bug + '&path=' + encodeURIComponent(pathStr) + tlsQuery + '#' + encodeURIComponent('VLESS-REV-' + proxy);
      } else if (mode === 'TROJAN_REV') {
        titleText = 'DDFATHU-TROJAN-SNI-WS (REV)';
        finalLink = 'trojan://' + uuid + '@' + currentWorkerHost + ':' + selectedPort + '?type=ws&host=' + bug + '&path=' + encodeURIComponent(pathStr) + tlsQuery + '#' + encodeURIComponent('TROJAN-REV-' + proxy);
      } else if (mode === 'VMESS_REV') {
        titleText = 'DDFATHU-VMESS-SNI-WS (REV)';
        var vmessJsonRev = {
          v: "2",
          ps: 'VMESS-REV-' + proxy,
          add: currentWorkerHost,
          port: selectedPort,
          id: uuid,
          aid: "0",
          scy: "zero",
          net: "ws",
          type: "none",
          host: bug,
          path: pathStr,
          tls: isNTLS ? "" : "tls",
          sni: isNTLS ? "" : currentWorkerHost,
          alpn: "",
          fp: isNTLS ? "" : "chrome"
        };
        finalLink = "vmess://" + btoa(unescape(encodeURIComponent(JSON.stringify(vmessJsonRev))));
      } else if (mode === 'VLESS_CDN') {
        titleText = 'DDFATHU-VLESS-CDN-NTLS';
        finalLink = 'vless://' + uuid + '@' + bug + ':' + selectedPort + '?encryption=none&type=ws&host=' + currentWorkerHost + '&path=' + encodeURIComponent(pathStr) + '&security=none#' + encodeURIComponent('VLESS-CDN-' + proxy);
      } else if (mode === 'TROJAN_CDN') {
        titleText = 'DDFATHU-TROJAN-CDN-NTLS';
        finalLink = 'trojan://' + uuid + '@' + bug + ':' + selectedPort + '?type=ws&host=' + currentWorkerHost + '&path=' + encodeURIComponent(pathStr) + '&security=none#' + encodeURIComponent('TROJAN-CDN-' + proxy);
      } else if (mode === 'VMESS_CDN') {
        titleText = 'DDFATHU-VMESS-CDN-NTLS';
        var vmessJsonCdn = {
          v: "2",
          ps: 'VMESS-CDN-' + proxy,
          add: bug,
          port: selectedPort,
          id: uuid,
          aid: "0",
          scy: "zero",
          net: "ws",
          type: "none",
          host: currentWorkerHost,
          path: pathStr,
          tls: "",
          sni: "",
          alpn: ""
        };
        finalLink = "vmess://" + btoa(unescape(encodeURIComponent(JSON.stringify(vmessJsonCdn))));
      }

      document.getElementById('result_title').innerText = titleText;
      document.getElementById('out_result').innerText = finalLink;
      document.getElementById('gen_results').style.display = 'block';
    }

    function copyText(id) {
      var text = document.getElementById(id).innerText.trim();
      navigator.clipboard.writeText(text).then(function() { alert('✅ Config Berhasil Disalin!'); });
    }

    async function savePartialToKV(partialData) {
      var payload = Object.assign({}, currentConfig, partialData);
      try {
        var res = await fetch('/api/save-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var result = await res.json();
        if (res.ok && result.success) {
          alert('✅ Berhasil Disimpan Ke KV!');
          location.reload();
        } else {
          alert('❌ Gagal: ' + (result.message || 'Error'));
        }
      } catch (err) {
        alert('❌ Error: ' + err.message);
      }
    }

    async function saveOutboundModeOnly() {
      var mode = document.getElementById('set_outbound_mode').value;
      await savePartialToKV({ OUTBOUND_MODE: mode });
    }

    async function saveSpeedOnly() {
      var payload = {
        ZERO_COPY_MODE: document.getElementById('set_zero_copy').value,
        EARLY_FLUSH_MODE: document.getElementById('set_early_flush').value,
        STREAM_BUFFER_MODE: document.getElementById('set_buffer_mode').value
      };
      await savePartialToKV(payload);
    }

    async function saveRelayOnly() {
      var mode = document.getElementById('set_udp_mode').value;
      var host = document.getElementById('set_relay_host').value.trim();
      var port = document.getElementById('set_relay_port').value.trim();

      var updatedRelayHistory = (currentConfig.RELAY_HISTORY || []).slice();
      if (document.getElementById('relay_select').value === 'CUSTOM' && host) {
        var newRelay = { label: 'Relay: ' + host + ':' + port, host: host, port: port };
        if (!updatedRelayHistory.some(function(h) { return h.host === host && h.port == port; })) {
          updatedRelayHistory.push(newRelay);
        }
      }

      await savePartialToKV({
        UDP_MODE: mode,
        UDP_RELAY_HOST: host,
        UDP_RELAY_PORT: parseInt(port, 10) || 443,
        RELAY_HISTORY: updatedRelayHistory
      });
    }

    async function saveUrlsOnly() {
      var bankUrl = document.getElementById('set_prx_bank_url').value.trim();
      var kvUrl = document.getElementById('set_kv_prx_url').value.trim();
      var revTarget = document.getElementById('set_reverse_target').value.trim();

      var updatedBankHistory = (currentConfig.PRX_BANK_HISTORY || []).slice();
      if (document.getElementById('prx_bank_select').value === 'CUSTOM' && bankUrl) {
        if (!updatedBankHistory.some(function(h) { return h.url === bankUrl; })) {
          updatedBankHistory.push({ label: 'Bank: ' + bankUrl, url: bankUrl });
        }
      }

      var updatedKvHistory = (currentConfig.KV_PRX_HISTORY || []).slice();
      if (document.getElementById('kv_prx_select').value === 'CUSTOM' && kvUrl) {
        if (!updatedKvHistory.some(function(h) { return h.url === kvUrl; })) {
          updatedKvHistory.push({ label: 'JSON: ' + kvUrl, url: kvUrl });
        }
      }

      await savePartialToKV({
        PRX_BANK_URL: bankUrl,
        KV_PRX_URL: kvUrl,
        REVERSE_PRX_TARGET: revTarget,
        PRX_BANK_HISTORY: updatedBankHistory,
        KV_PRX_HISTORY: updatedKvHistory
      });
    }

    async function saveRawDataOnly() {
      var rawJson = document.getElementById('set_raw_json').value.trim();
      var rawTxt = document.getElementById('set_raw_txt').value.trim();
      await savePartialToKV({ RAW_KV_JSON_DATA: rawJson, RAW_KV_TXT_DATA: rawTxt });
    }
  </script>
</body>
</html>`;
}

async function reverseWeb(request, target, currentConfig) {
  try {
    if (!target || target.trim() === "" || target === "example.com") {
      return new Response(getDashboardHtml(currentConfig), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          ...CORS_HEADER_OPTIONS
        }
      });
    }

    const targetUrl = new URL(request.url);
    const targetChunk = target.split(":");
    targetUrl.hostname = targetChunk[0];
    targetUrl.port = targetChunk[1]?.toString() || "443";

    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.set("Host", targetUrl.hostname);
    modifiedHeaders.set("X-Forwarded-Host", request.headers.get("Host"));

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: modifiedHeaders,
      body: request.body,
      redirect: "follow"
    });

    const response = await fetch(modifiedRequest);
    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
      newResponse.headers.set(key, value);
    }
    newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");
    return newResponse;
  } catch (err) {
    return new Response(getDashboardHtml(currentConfig), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...CORS_HEADER_OPTIONS
      }
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      APP_DOMAIN = url.hostname;
      serviceName = APP_DOMAIN.split(".")[0];

      const currentConfig = await getConfig(env);

      // UI Route
      if (url.pathname === "/ui" || url.pathname === "/ui/") {
        return new Response(getDashboardHtml(currentConfig), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            ...CORS_HEADER_OPTIONS
          }
        });
      }

      // API: Get Proxy List
      if (url.pathname === "/api/get-proxy-list") {
        const list = await getPrxList(currentConfig);
        return new Response(JSON.stringify(list), {
          headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json" }
        });
      }

      // API: Save Partial Config to KV
      if (url.pathname === "/api/save-config" && request.method === "POST") {
        if (!env || !env.CONFIG_KV) {
          return new Response(
            JSON.stringify({ success: false, message: "Binding CONFIG_KV belum diset di Cloudflare Worker!" }),
            { status: 400, headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json" } }
          );
        }
        const body = await request.json();
        let oldConfig = {};
        try {
          const stored = await env.CONFIG_KV.get("APP_CONFIG", { type: "json" });
          if (stored) oldConfig = stored;
        } catch (e) {}

        const mergedConfig = { ...DEFAULT_CONFIG, ...oldConfig, ...body };
        await env.CONFIG_KV.put("APP_CONFIG", JSON.stringify(mergedConfig));
        return new Response(
          JSON.stringify({ success: true, message: "Pengaturan berhasil disimpan ke KV." }),
          { status: 200, headers: { ...CORS_HEADER_OPTIONS, "Content-Type": "application/json" } }
        );
      }

      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader === "websocket") {
        const rawPath = decodeURIComponent(url.pathname); 
        const cleanPath = rawPath.replace(/^\//, "").trim();
        const upperPath = cleanPath.toUpperCase();

        if (upperPath === "MULTI") {
          return await websocketHandler(request, currentConfig, "MULTI", "");
        }
        if (upperPath === "DIRECT") {
          return await websocketHandler(request, currentConfig, "DIRECT", "");
        }
        if (upperPath === "SEMUA") {
          const picked = await getBestInMemoryProxy(currentConfig);
          return await websocketHandler(request, currentConfig, "PROXY", picked);
        }

        // 1. Deteksi Path Kode Negara 2 Huruf (/SG, /ID, /US, /JP, dll)
        if (/^[A-Z]{2}$/.test(upperPath)) {
          const pickedCountryProxy = await getProxyByCountry(currentConfig, upperPath);
          return await websocketHandler(request, currentConfig, "PROXY", pickedCountryProxy);
        }

        // 2. Deteksi Manual IP:PORT atau IP:PORT@USER:PASS
        const proxyAuthMatch = cleanPath.match(/^([a-zA-Z0-9.-]+:\d+(@[a-zA-Z0-9._~%!$&'()*+,;=-]+:[a-zA-Z0-9._~%!$&'()*+,;=-]+)?)$/);
        if (proxyAuthMatch) {
          return await websocketHandler(request, currentConfig, "PROXY", proxyAuthMatch[1]);
        }

        const prxMatch = rawPath.match(/^\/(.+[:=-]\d+(@.+:.+)?)$/);
        if (prxMatch) {
          return await websocketHandler(request, currentConfig, "PROXY", prxMatch[1]);
        }

        const picked = await getBestSgProxyInternal(currentConfig);
        return await websocketHandler(request, currentConfig, "PROXY", picked);
      }

      return await reverseWeb(request, currentConfig.REVERSE_PRX_TARGET, currentConfig);
    } catch (err) {
      return new Response(`Worker Fatal Error: ${err.message}`, { status: 500, headers: CORS_HEADER_OPTIONS });
    }
  }
};

async function websocketHandler(request, config, routingMode = "PROXY", assignedProxy = "") {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = { value: null };
  let udpRelaySession = null;
  let isDNS = false;

  readableWebSocketStream.pipeTo(
    new WritableStream({
      async write(chunk, controller) {
        if (isDNS && config.DNS_TYPE === "DOH") {
          return handleDoHOutbound(config.DOH_URL, chunk, webSocket, null, log);
        }

        if (remoteSocketWrapper.value) {
          const writer = remoteSocketWrapper.value.writable.getWriter();
          await writer.write(chunk);
          writer.releaseLock();
          return;
        }

        if (udpRelaySession) {
          await udpRelaySession.write(chunk);
          return;
        }

        const protocol = await protocolSniffer(chunk);
        let protocolHeader;

        if (protocol === atob(horse)) protocolHeader = readHorseHeader(chunk);
        else if (protocol === atob(flash)) protocolHeader = await readStreamHeader(chunk);
        else if (protocol === atob(neko)) protocolHeader = readNekoHeader(chunk);
        else if (protocol === "ss") protocolHeader = readSsHeader(chunk);
        else throw new Error("Unknown Protocol!");

        addressLog = protocolHeader.addressRemote;
        portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

        if (protocolHeader.hasError) throw new Error(protocolHeader.message);

        let responseHeader = protocolHeader.version;
        if (protocol === atob(flash) && protocolHeader.needsResponse) {
          responseHeader = await generateStreamResponseHeader(
            protocolHeader.responseOptions,
            protocolHeader.encKey,
            protocolHeader.encIv
          );
        }

        // Penanganan Outbound UDP via WebSocket Relay (Exact 1:1)
        if (protocolHeader.isUDP) {
          if (protocolHeader.portRemote === 53 && config.DNS_TYPE === "DOH") {
            isDNS = true;
            return handleDoHOutbound(config.DOH_URL, chunk, webSocket, responseHeader, log);
          }

          udpRelaySession = new ExactPacketUdpRelay(
            config,
            protocol,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            webSocket,
            responseHeader
          );
          await udpRelaySession.init(protocolHeader.rawClientData);
          return;
        }

        handleTCPOutBound(
          remoteSocketWrapper,
          protocolHeader.addressRemote,
          protocolHeader.portRemote,
          protocolHeader.rawClientData,
          webSocket,
          responseHeader,
          log,
          config,
          routingMode,
          assignedProxy
        );
      },
      close() { 
        if (udpRelaySession) udpRelaySession.close();
        log(`readableWebSocketStream is closed`); 
      },
      abort(reason) { 
        if (udpRelaySession) udpRelaySession.close();
        log(`readableWebSocketStream is aborted`, reason); 
      }
    })
  ).catch(err => log("Stream pipe error", err));

  return new Response(null, { status: 101, webSocket: client });
}

// 1:1 PACKET-UDP ENGINE KE WEBSOCKET RELAY (RAILWAY VLRLY004)
class ExactPacketUdpRelay {
  constructor(config, protocol, defaultAddr, defaultPort, clientWs, responseHeader) {
    this.config = config;
    this.protocol = protocol;
    this.defaultAddr = defaultAddr;
    this.defaultPort = defaultPort;
    this.clientWs = clientWs;
    this.responseHeader = responseHeader;
    this.relayWs = null;
    this.isReady = false;
    this.queue = [];
    this.closed = false;
    this.inBuffer = new Uint8Array(0);
    this.outBuffer = new Uint8Array(0);
  }

  async init(initialData) {
    try {
      const relayHost = (this.config.UDP_RELAY_HOST || "wsudprelay.up.railway.app")
        .replace(/^https?:\/\//i, "")
        .replace(/^wss?:\/\//i, "")
        .replace(/\/+$/, "");

      const wsUrl = `https://${relayHost}/`;
      const resp = await fetch(wsUrl, { headers: { Upgrade: "websocket" } });
      const rWs = resp.webSocket;
      if (!rWs) throw new Error("Failed to connect to Railway relay");
      rWs.accept();
      this.relayWs = rWs;

      // Handshake VLRLY004 + Mode 0x03 (Packet-UDP)
      rWs.send(concatBytes(RELAY_MAGIC, new Uint8Array([RELAY_MODE_PACKET_UDP])));

      let gotAck = false;

      rWs.addEventListener("message", async (event) => {
        const chunk = new Uint8Array(event.data);
        if (!gotAck) {
          if (chunk.byteLength > 0 && chunk[0] === 0) {
            gotAck = true;
            this.isReady = true;
            this.flush();
            if (chunk.byteLength > 1) {
              this.outBuffer = concatBytes(this.outBuffer, chunk.subarray(1));
            }
          } else {
            this.close();
            return;
          }
        } else {
          this.outBuffer = concatBytes(this.outBuffer, chunk);
        }

        while (this.outBuffer.byteLength > 0) {
          const ep = parseRelayEndpoint(this.outBuffer, 0);
          if (!ep || this.outBuffer.byteLength < ep.next + 2) break;

          const payloadLen = (this.outBuffer[ep.next] << 8) | this.outBuffer[ep.next + 1];
          const totalEnd = ep.next + 2 + payloadLen;
          if (this.outBuffer.byteLength < totalEnd) break;

          const payload = this.outBuffer.slice(ep.next + 2, totalEnd);
          this.outBuffer = this.outBuffer.slice(totalEnd);

          this.emitToClient(ep, payload);
        }
      });

      rWs.addEventListener("close", () => this.close());
      rWs.addEventListener("error", () => this.close());

      if (initialData && initialData.byteLength > 0) {
        await this.write(initialData);
      }
    } catch (e) {
      this.close();
    }
  }

  async write(chunk) {
    if (this.closed) return;
    this.inBuffer = concatBytes(this.inBuffer, chunk);

    while (this.inBuffer.byteLength > 0) {
      let targetAddr = this.defaultAddr;
      let targetPort = this.defaultPort;
      let payload = null;
      let consumed = 0;

      if (this.protocol === atob(horse)) {
        const ep = parseSocksAddress(this.inBuffer, 0);
        if (!ep || this.inBuffer.byteLength < ep.next + 4) break;
        const len = (this.inBuffer[ep.next] << 8) | this.inBuffer[ep.next + 1];
        const end = ep.next + 4 + len;
        if (this.inBuffer.byteLength < end) break;

        targetAddr = ep.address;
        targetPort = ep.port;
        payload = this.inBuffer.slice(ep.next + 4, end);
        consumed = end;
      } else {
        if (this.inBuffer.byteLength < 2) break;
        const len = (this.inBuffer[0] << 8) | this.inBuffer[1];
        if (this.inBuffer.byteLength < 2 + len) break;
        payload = this.inBuffer.slice(2, 2 + len);
        consumed = 2 + len;
      }

      this.inBuffer = this.inBuffer.slice(consumed);

      const epBytes = encodeRelayEndpoint(targetAddr, targetPort);
      const lenBytes = new Uint8Array([(payload.byteLength >>> 8) & 0xff, payload.byteLength & 0xff]);
      const packet = concatBytes(epBytes, lenBytes, payload);

      if (this.isReady && this.relayWs && this.relayWs.readyState === WS_READY_STATE_OPEN) {
        this.relayWs.send(packet);
      } else {
        this.queue.push(packet);
      }
    }
  }

  emitToClient(ep, payload) {
    if (this.clientWs.readyState !== WS_READY_STATE_OPEN) return;

    let packetForClient;
    if (this.protocol === atob(horse)) {
      packetForClient = encodeTrojanUdpPacket(ep, payload);
    } else {
      const lenBytes = new Uint8Array([(payload.byteLength >>> 8) & 0xff, payload.byteLength & 0xff]);
      packetForClient = concatBytes(lenBytes, payload);
    }

    if (this.responseHeader) {
      this.clientWs.send(concatBytes(this.responseHeader, packetForClient).buffer);
      this.responseHeader = null;
    } else {
      this.clientWs.send(packetForClient.buffer || packetForClient);
    }
  }

  flush() {
    while (this.queue.length > 0) {
      const p = this.queue.shift();
      if (this.relayWs && this.relayWs.readyState === WS_READY_STATE_OPEN) {
        this.relayWs.send(p);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.relayWs?.close(); } catch (e) {}
    try { safeCloseWebSocket(this.clientWs); } catch (e) {}
  }
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log,
  config,
  routingMode,
  assignedProxy
) {
  async function connectAndWrite(address, port, timeoutMs = 0) {
    const tcpSocket = connect({ hostname: address, port: parseInt(port, 10) });
    remoteSocket.value = tcpSocket;
    log(`Connecting Direct to ${address}:${port}`);

    if (timeoutMs > 0) {
      await Promise.race([
        tcpSocket.opened,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
      ]);
    } else {
      await tcpSocket.opened;
    }

    if (rawClientData && rawClientData.byteLength > 0) {
      const writer = tcpSocket.writable.getWriter();
      await writer.write(rawClientData);
      writer.releaseLock();
    }
    return tcpSocket;
  }

  async function connectViaHttpProxy(parsedPrx, targetHost, targetPort) {
    const tcpSocket = connect({ hostname: parsedPrx.host, port: parsedPrx.port });
    remoteSocket.value = tcpSocket;
    log(`Tunneling via HTTP CONNECT -> ${parsedPrx.host}:${parsedPrx.port} for target [${targetHost}:${targetPort}]`);

    await tcpSocket.opened;

    const writer = tcpSocket.writable.getWriter();
    let connectReq = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
    if (parsedPrx.user && parsedPrx.pass) {
      const authBase64 = btoa(`${parsedPrx.user}:${parsedPrx.pass}`);
      connectReq += `Proxy-Authorization: Basic ${authBase64}\r\n`;
    }
    connectReq += `User-Agent: Cloudflare-Worker\r\nProxy-Connection: Keep-Alive\r\n\r\n`;

    await writer.write(new TextEncoder().encode(connectReq));
    const reader = tcpSocket.readable.getReader();
    const { value: resChunk } = await reader.read();
    reader.releaseLock();

    const responseText = new TextDecoder().decode(resChunk || new Uint8Array(0));
    if (!responseText.includes(" 200 ")) {
      throw new Error(`Proxy tunneling failed: ${responseText.split("\r\n")[0]}`);
    }

    if (rawClientData && rawClientData.byteLength > 0) {
      await writer.write(rawClientData);
    }
    writer.releaseLock();
    return tcpSocket;
  }

  async function routeViaAssignedProxy() {
    const prxTarget = assignedProxy || (await getBestSgProxyInternal(config));
    const parsed = parseProxy(prxTarget);
    if (!parsed) throw new Error("Invalid proxy");

    log(`Routing ke Target Proxy: ${parsed.host}:${parsed.port} -> ${addressRemote}:${portRemote}`);
    
    let tcpSocket = await connectViaHttpProxy(parsed, addressRemote, portRemote);

    tcpSocket.closed.catch(() => {}).finally(() => safeCloseWebSocket(webSocket));
    remoteSocketToWSZeroCopy(tcpSocket, webSocket, responseHeader, null, log);
  }

  const mode = config.OUTBOUND_MODE || "FULL_PROXY";

  if (mode === "FULL_PROXY" && routingMode === "PROXY") {
    try {
      await routeViaAssignedProxy();
      return;
    } catch (err) {
      log(`Full proxy dial error: ${err.message}`);
      safeCloseWebSocket(webSocket);
      return;
    }
  }

  if (mode === "PURE_DIRECT" || routingMode === "DIRECT") {
    try {
      const tcpSocket = await connectAndWrite(addressRemote, portRemote, 0);
      remoteSocketToWSZeroCopy(tcpSocket, webSocket, responseHeader, null, log);
    } catch (err) {
      safeCloseWebSocket(webSocket);
    }
    return;
  }

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote, 450);
    remoteSocketToWSZeroCopy(
      tcpSocket,
      webSocket,
      responseHeader,
      async () => {
        try {
          await routeViaAssignedProxy();
        } catch (e) {
          safeCloseWebSocket(webSocket);
        }
      },
      log
    );
  } catch (err) {
    log(`Direct timeout/gagal (${err.message}), dialihkan ke target proxy path...`);
    try {
      await routeViaAssignedProxy();
    } catch (e) {
      safeCloseWebSocket(webSocket);
    }
  }
}

async function remoteSocketToWSZeroCopy(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;

  await remoteSocket.readable.pipeTo(
    new WritableStream({
      write(chunk) {
        hasIncomingData = true;
        if (webSocket.readyState !== WS_READY_STATE_OPEN) return;

        if (header && header.byteLength > 0) {
          const combined = new Uint8Array(header.byteLength + chunk.byteLength);
          combined.set(new Uint8Array(header), 0);
          combined.set(new Uint8Array(chunk), header.byteLength);
          webSocket.send(combined.buffer);
          header = null;
        } else {
          webSocket.send(chunk);
        }
      },
      close() { log(`remoteSocket closed`); },
      abort(reason) { console.error(`remoteSocket abort`, reason); }
    })
  ).catch(() => safeCloseWebSocket(webSocket));

  if (!hasIncomingData && retry) {
    retry();
  }
}

async function handleDoHOutbound(dohUrl, dataChunk, webSocket, responseHeader, log) {
  try {
    let protocolHeader = responseHeader;
    const dohResponse = await fetch(dohUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
        "Accept": "application/dns-message",
      },
      body: dataChunk,
    });

    if (dohResponse.ok && webSocket.readyState === WS_READY_STATE_OPEN) {
      const dnsResponseBuffer = await dohResponse.arrayBuffer();
      if (protocolHeader) {
        webSocket.send(await new Blob([protocolHeader, dnsResponseBuffer]).arrayBuffer());
      } else {
        webSocket.send(dnsResponseBuffer);
      }
    }
  } catch (e) {
    console.error(`Error handling DoH: ${e.message}`);
  }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  return new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) return;
        controller.enqueue(event.data);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) return;
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) controller.error(error);
      else if (earlyData) controller.enqueue(earlyData);
    },
    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) return;
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {}
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
      if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
        if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
          return atob(horse);
        }
      }
    }
  }
  if (buffer.byteLength >= 18) {
    const version = new Uint8Array(buffer.slice(0, 1))[0];
    if (version === 0) {
      const protocolUuid = new Uint8Array(buffer.slice(1, 17));
      if (arrayBufferToHex(protocolUuid).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) {
        return atob(neko);
      }
    }
  }
  if (buffer.byteLength >= 42) {
    const firstByte = new Uint8Array(buffer.slice(0, 1))[0];
    if (firstByte === 0x01 || firstByte === 0x03 || firstByte === 0x04) return "ss";
    return atob(flash);
  }
  return "ss";
}

async function generateStreamResponseHeader(responseOptions, encKey, encIv) {
  try {
    const key = (await sha256(encKey)).slice(0, 16);
    const lengthKey = (await kdf(key, [SALT_B1])).slice(0, 16);
    const lengthIv = (await kdf(key, [SALT_B2])).slice(0, 12);
    const lengthData = new Uint8Array([0, 4]);
    const encryptedLength = await aesGcmEncrypt(lengthKey, lengthIv, lengthData, new Uint8Array(0));
    const headerPayload = new Uint8Array([responseOptions[0], 0x00, 0x00, 0x00]);
    const payloadKey = (await kdf(key, [SALT_B3])).slice(0, 16);
    const payloadIv = (await kdf(key, [SALT_B4])).slice(0, 12);
    const encryptedPayload = await aesGcmEncrypt(payloadKey, payloadIv, headerPayload, new Uint8Array(0));
    const response = new Uint8Array(encryptedLength.length + encryptedPayload.length);
    response.set(encryptedLength, 0);
    response.set(encryptedPayload, encryptedLength.length);
    return response;
  } catch (e) {
    return new Uint8Array(0);
  }
}

async function readStreamHeader(buffer) {
  try {
    const uuidString = "00000000-0000-0000-0000-000000000000";
    const uuidBytes = new Uint8Array(uuidString.replace(/-/g, "").match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const authKey = await md5(uuidBytes, new TextEncoder().encode(atob("YzQ4NjE5ZmUtOGYwMi00OWUwLWI5ZTktZWRmNzYzZTE3ZTIx")));
    const authId = new Uint8Array(buffer.slice(0, 16));
    const encryptedLength = new Uint8Array(buffer.slice(16, 34));
    const nonce = new Uint8Array(buffer.slice(34, 42));
    const lengthKey = (await kdf(authKey, [SALT_A1, authId, nonce])).slice(0, 16);
    const lengthIv = (await kdf(authKey, [SALT_A2, authId, nonce])).slice(0, 12);
    const lengthBytes = await aesGcmDecrypt(lengthKey, lengthIv, encryptedLength, authId);
    const headerLength = (lengthBytes[0] << 8) | lengthBytes[1];
    const encryptedHeader = new Uint8Array(buffer.slice(42, 42 + headerLength + 16));
    const payloadKey = (await kdf(authKey, [SALT_A3, authId, nonce])).slice(0, 16);
    const payloadIv = (await kdf(authKey, [SALT_A4, authId, nonce])).slice(0, 12);
    const headerPayload = await aesGcmDecrypt(payloadKey, payloadIv, encryptedHeader, authId);
    const view = new DataView(headerPayload.buffer);
    let offset = 0;
    const version = view.getUint8(offset++);
    if (version !== 1) return { hasError: true, message: `Invalid protocol: ${version}` };
    const encIv = new Uint8Array(headerPayload.slice(offset, offset + 16)); offset += 16;
    const encKey = new Uint8Array(headerPayload.slice(offset, offset + 16)); offset += 16;
    const options = new Uint8Array(headerPayload.slice(offset, offset + 4)); offset += 4;
    const cmd = view.getUint8(offset++);
    const isUDP = cmd !== 0x01;
    const portRemote = view.getUint16(offset, false); offset += 2;
    const addressType = view.getUint8(offset++);
    let addressRemote = "";

    switch (addressType) {
      case 1:
        addressRemote = `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
        offset += 4;
        break;
      case 2:
      case 3:
        const domainLength = view.getUint8(offset++);
        addressRemote = new TextDecoder().decode(headerPayload.slice(offset, offset + domainLength));
        offset += domainLength;
        break;
      case 4:
        const ipv6Parts = [];
        for (let i = 0; i < 8; i++) ipv6Parts.push(view.getUint16(offset + i * 2, false).toString(16));
        addressRemote = ipv6Parts.join(":");
        offset += 16;
        break;
      default:
        return { hasError: true, message: `Invalid address type: ${addressType}` };
    }

    const rawDataIndex = 42 + headerLength + 16;
    return {
      hasError: false,
      addressRemote,
      addressType,
      portRemote,
      rawDataIndex,
      rawClientData: buffer.slice(rawDataIndex),
      version: new Uint8Array([options[0], 0]),
      isUDP,
      needsResponse: true,
      responseOptions: options,
      encKey,
      encIv,
    };
  } catch (e) {
    return { hasError: true, message: "Stream failed: " + e.message };
  }
}

function readSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer);
  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) ipv6.push(dataView.getUint16(i * 2).toString(16));
      addressValue = ipv6.join(":");
      break;
    default:
      return { hasError: true, message: `Invalid addressType: ${addressType}` };
  }

  const portIndex = addressValueIndex + addressLength;
  const portRemote = new DataView(ssBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function readNekoHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1));
  let isUDP = false;
  const optLength = new Uint8Array(buffer.slice(17, 18))[0];
  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 2) isUDP = true;
  else if (cmd !== 1) return { hasError: true, message: `cmd ${cmd} unsupported` };

  const portIndex = 18 + optLength + 1;
  const portRemote = new DataView(buffer.slice(portIndex, portIndex + 2)).getUint16(0);
  let addressIndex = portIndex + 2;
  const addressType = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1))[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2:
      addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3:
      addressLength = 16;
      const dataView = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) ipv6.push(dataView.getUint16(i * 2).toString(16));
      addressValue = ipv6.join(":");
      break;
    default:
      return { hasError: true, message: `invalid addressType ${addressType}` };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: buffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP,
  };
}

function readHorseHeader(buffer) {
  const dataBuffer = buffer.slice(58);
  if (dataBuffer.byteLength < 6) return { hasError: true, message: "invalid data" };
  let isUDP = false;
  const view = new DataView(dataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) isUDP = true;
  else if (cmd != 1) throw new Error("Unsupported cmd");

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) ipv6.push(dataView.getUint16(i * 2).toString(16));
      addressValue = ipv6.join(":");
      break;
    default:
      return { hasError: true, message: `invalid addressType ${addressType}` };
  }

  const portIndex = addressValueIndex + addressLength;
  const portRemote = new DataView(dataBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: dataBuffer.slice(portIndex + 4),
    version: null,
    isUDP,
  };
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) return { error: null };
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Crypto Helpers
async function md5(...inputs) {
  const combined = new Uint8Array(inputs.reduce((acc, input) => acc + input.length, 0));
  let offset = 0;
  for (const input of inputs) {
    combined.set(new Uint8Array(input), offset);
    offset += input.length;
  }
  const hashBuffer = await crypto.subtle.digest("MD5", combined);
  return new Uint8Array(hashBuffer);
}

async function sha256(input) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(hashBuffer);
}

async function kdf(key, path) {
  async function recursiveHash(keyBytes, innerHashFn) {
    return async (data) => {
      const ipad = new Uint8Array(64);
      const opad = new Uint8Array(64);
      ipad.set(keyBytes.slice(0, Math.min(64, keyBytes.length)));
      opad.set(keyBytes.slice(0, Math.min(64, keyBytes.length)));
      for (let i = 0; i < 64; i++) {
        ipad[i] ^= 0x36;
        opad[i] ^= 0x5c;
      }
      const innerData = new Uint8Array(ipad.length + data.length);
      innerData.set(ipad);
      innerData.set(data, ipad.length);
      const innerResult = await innerHashFn(innerData);
      const outerData = new Uint8Array(opad.length + innerResult.length);
      outerData.set(opad);
      outerData.set(innerResult, opad.length);
      return await innerHashFn(outerData);
    };
  }

  const sha256Hash = async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let currentHashFn = await recursiveHash(new TextEncoder().encode("VMess AEAD KDF"), sha256Hash);

  for (const salt of path) {
    const saltBytes = typeof salt === "string" ? new TextEncoder().encode(salt) : new Uint8Array(salt);
    currentHashFn = await recursiveHash(saltBytes, currentHashFn);
  }
  return await currentHashFn(key);
}

async function aesGcmDecrypt(key, nonce, data, aad) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, cryptoKey, data);
    return new Uint8Array(decrypted);
  } catch (e) {
    throw new Error("AEAD decrypt error: " + e.message);
  }
}

async function aesGcmEncrypt(key, nonce, data, aad) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, cryptoKey, data);
  return new Uint8Array(encrypted);
}
