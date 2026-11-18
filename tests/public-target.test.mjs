import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress } from "../lib/public-target.mjs";

test("blocks IPv4 private, loopback, link-local and carrier-grade ranges", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "169.254.1.1", "172.20.0.1", "192.168.1.1", "100.64.0.1"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("blocks IPv4 documentation and special-purpose ranges", () => {
  for (const address of ["192.0.2.1", "198.51.100.2", "203.0.113.4", "198.18.0.1", "224.0.0.1"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("allows ordinary public IPv4 addresses", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("blocks non-global, mapped, documentation and transition IPv6 ranges", () => {
  for (const address of ["::1", "::", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002::1"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("allows ordinary global-unicast IPv6 addresses", () => {
  for (const address of ["2001:4860:4860::8888", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});
