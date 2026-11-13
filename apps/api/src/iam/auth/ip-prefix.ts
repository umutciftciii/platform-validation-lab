/**
 * Network prefix of a client address (F1-002, design 3.2, 8.2): IPv4 /24, IPv6 /48. Sessions and
 * throttle buckets keep only the prefix, never the full address. IPv4-mapped IPv6 addresses
 * (`::ffff:a.b.c.d`) count as IPv4. Returns null for anything that is not an IP address.
 */
import { isIPv4, isIPv6 } from "node:net";

export function ipPrefix(address: string): string | null {
  let ip = address.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1] as string;
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split(".");
    return `${a}.${b}.${c}.0/24`;
  }
  if (!isIPv6(ip)) return null;
  const groups = expandIPv6(ip);
  return `${groups.slice(0, 3).join(":")}::/48`;
}

function expandIPv6(ip: string): string[] {
  const noZone = ip.split("%")[0] as string;
  const [head, tail] = noZone.includes("::") ? noZone.split("::") : [noZone, undefined];
  const h = head ? (head as string).split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array<string>(8 - h.length - t.length).fill("0");
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16).toString(16));
}
