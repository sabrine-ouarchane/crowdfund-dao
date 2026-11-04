const JWT = import.meta.env.VITE_PINATA_JWT;
const GATEWAY = import.meta.env.VITE_PINATA_GATEWAY || "gateway.pinata.cloud";

export const ipfsConfigured = Boolean(JWT);

export function ipfsToHttp(uri) {
  const cid = uri.startsWith("ipfs://") ? uri.slice(7) : uri;
  return `https://${GATEWAY}/ipfs/${cid}`;
}

async function pinataRequest(endpoint, body, isJson) {
  const res = await fetch(`https://api.pinata.cloud/pinning/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${JWT}`,
      ...(isJson ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });
  if (!res.ok) throw new Error(`Pinata a refuse l'envoi (${res.status}) : ${await res.text()}`);
  return (await res.json()).IpfsHash;
}

export function uploadFile(file) {
  const data = new FormData();
  data.append("file", file);
  data.append("pinataMetadata", JSON.stringify({ name: file.name }));
  return pinataRequest("pinFileToIPFS", data, false);
}

export function uploadJSON(content, name) {
  return pinataRequest(
    "pinJSONToIPFS",
    JSON.stringify({ pinataContent: content, pinataMetadata: { name } }),
    true
  );
}

const cache = {};
export async function fetchMetadata(cid) {
  if (cache[cid]) return cache[cid];
  const res = await fetch(ipfsToHttp(cid));
  if (!res.ok) throw new Error(`IPFS ${res.status}`);
  cache[cid] = await res.json();
  return cache[cid];
}