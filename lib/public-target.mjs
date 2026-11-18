import { isIP } from "node:net";

function ipv6Value(address) {
  let value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    value = value.slice(0, lastColon + 1) + high + ":" + low;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((total, group) => (total << 16n) | BigInt("0x" + group), 0n);
}

export function isBlockedAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 2 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    const value = ipv6Value(address);
    if (value === null) return true;
    const globalUnicast = (value >> 125n) === 1n; // 2000::/3
    const documentation = (value >> 96n) === BigInt("0x20010db8");
    const protocolAssignments = (value >> 105n) === BigInt("0x200100");
    const sixToFour = (value >> 112n) === BigInt("0x2002");
    return !globalUnicast || documentation || protocolAssignments || sixToFour;
  }
  return true;
}
