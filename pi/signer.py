#!/usr/bin/env python3
"""
ATECC608 meta-transaction signer.

The chip holds a NIST P-256 key that owns the ChipAccount contract. This script:

  1. announces the chip's public key to the app  (POST /api/device)
  2. polls the app for transfers waiting for a signature (GET /api/requests?status=pending)
  3. signs the 32-byte EIP-712 digest with the chip (atcab_sign, or a software key in --mock mode)
  4. posts the signature back; the app's relay pays gas and settles it onchain

Usage:
  python3 signer.py pubkey [--mock]                       print the signer public key
  python3 signer.py sign --digest 0x... [--mock]          sign one digest (used by the Foundry tests via ffi)
  python3 signer.py run --app http://<mac-ip>:3000        daemon: announce, poll, sign, repeat
      [--mock] [--confirm | --button 17] [--name "pi-atecc608"] [--once]

Hardware options: --i2c-bus 1  --i2c-addr 0x60 (7-bit, 0x35 for TrustFLEX/TNG parts)  --slot 0
"""
import argparse
import json
import os
import sys
import time

P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
HERE = os.path.dirname(os.path.abspath(__file__))
MOCK_KEY_FILE = os.path.join(HERE, ".mock_key.pem")


def hexbytes(s: str, length: int) -> bytes:
    s = s[2:] if s.startswith("0x") else s
    b = bytes.fromhex(s)
    if len(b) != length:
        raise ValueError(f"expected {length} bytes, got {len(b)}")
    return b


def low_s(r: int, s: int):
    """Ethereum-side verifiers (OpenZeppelin P256) reject high-s signatures. (r, N-s) is equally valid."""
    if s > P256_N // 2:
        s = P256_N - s
    return r, s


# ----------------------------------------------------------------------------- backends


class SoftSigner:
    """Software P-256 key. Lets the whole pipeline run before the chip is wired up."""

    name = "mock"

    def __init__(self, key_hex=None):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        if key_hex:
            self.key = ec.derive_private_key(int(key_hex, 16), ec.SECP256R1())
        elif os.path.exists(MOCK_KEY_FILE):
            with open(MOCK_KEY_FILE, "rb") as f:
                self.key = serialization.load_pem_private_key(f.read(), password=None)
        else:
            self.key = ec.generate_private_key(ec.SECP256R1())
            pem = self.key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            with open(MOCK_KEY_FILE, "wb") as f:
                f.write(pem)
            os.chmod(MOCK_KEY_FILE, 0o600)
            print(f"[mock] generated software key -> {MOCK_KEY_FILE}", file=sys.stderr)

    def pubkey(self) -> bytes:
        n = self.key.public_key().public_numbers()
        return n.x.to_bytes(32, "big") + n.y.to_bytes(32, "big")

    def sign_digest(self, digest: bytes):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import Prehashed, decode_dss_signature

        der = self.key.sign(digest, ec.ECDSA(Prehashed(hashes.SHA256())))
        return low_s(*decode_dss_signature(der))


class AteccSigner:
    """ATECC608 over I2C via Microchip's cryptoauthlib python bindings (pip install cryptoauthlib)."""

    name = "atecc608"

    def __init__(self, bus=1, addr7=0x60, slot=0):
        import cryptoauthlib as cal

        self.cal = cal
        self.slot = slot
        cal.load_cryptoauthlib()
        cfg = cal.cfg_ateccx08a_i2c_default()
        cfg.cfg.atcai2c.bus = bus
        # cryptoauthlib stores the address in 8-bit form (7-bit address << 1)
        cfg.cfg.atcai2c.address = addr7 << 1
        cfg.devtype = cal.get_device_type_id("ATECC608")
        status = cal.atcab_init(cfg)
        if status != cal.ATCA_SUCCESS:
            raise RuntimeError(f"atcab_init failed: 0x{status:02X} (check wiring, i2cdetect -y {bus}, address)")
        rev = bytearray(4)
        cal.atcab_info(rev)
        self.revision = rev.hex()
        cfg_locked = cal.AtcaReference(False)
        data_locked = cal.AtcaReference(False)
        cal.atcab_is_locked(cal.LOCK_ZONE_CONFIG, cfg_locked)
        cal.atcab_is_locked(cal.LOCK_ZONE_DATA, data_locked)
        if not bool(cfg_locked.value) or not bool(data_locked.value):
            raise RuntimeError(
                "chip is not provisioned (config/data zone unlocked). Run provision.py first."
            )

    def pubkey(self) -> bytes:
        pub = bytearray(64)
        status = self.cal.atcab_get_pubkey(self.slot, pub)
        if status != self.cal.ATCA_SUCCESS:
            raise RuntimeError(f"atcab_get_pubkey failed: 0x{status:02X}")
        return bytes(pub)

    def sign_digest(self, digest: bytes):
        sig = bytearray(64)
        status = self.cal.atcab_sign(self.slot, digest, sig)
        if status != self.cal.ATCA_SUCCESS:
            raise RuntimeError(f"atcab_sign failed: 0x{status:02X}")
        r = int.from_bytes(sig[:32], "big")
        s = int.from_bytes(sig[32:], "big")
        return low_s(r, s)


def make_signer(args):
    if args.mock:
        return SoftSigner(args.mock_key)
    return AteccSigner(bus=args.i2c_bus, addr7=int(args.i2c_addr, 0), slot=args.slot)


# ----------------------------------------------------------------------------- commands


def cmd_pubkey(args):
    pub = make_signer(args).pubkey()
    if args.raw:
        print("0x" + pub.hex())
    else:
        print(json.dumps({"qx": "0x" + pub[:32].hex(), "qy": "0x" + pub[32:].hex()}, indent=2))


def cmd_sign(args):
    digest = hexbytes(args.digest, 32)
    r, s = make_signer(args).sign_digest(digest)
    if args.raw:
        print("0x" + r.to_bytes(32, "big").hex() + s.to_bytes(32, "big").hex())
    else:
        print(json.dumps({"r": "0x%064x" % r, "s": "0x%064x" % s}, indent=2))


def wait_for_approval(args, req):
    if args.button is not None:
        from gpiozero import Button  # pip install gpiozero

        btn = Button(args.button)
        print(f"  press the button on GPIO{args.button} to sign (Ctrl-C to skip)...")
        btn.wait_for_press()
        return True
    if args.confirm:
        ans = input("  sign this? [Y/n] ").strip().lower()
        return ans in ("", "y", "yes")
    return True


def cmd_run(args):
    import requests

    signer = make_signer(args)
    pub = signer.pubkey()
    qx, qy = "0x" + pub[:32].hex(), "0x" + pub[32:].hex()
    app = args.app.rstrip("/")
    print(f"[{signer.name}] public key\n  qx {qx}\n  qy {qy}")

    def announce():
        body = {"name": args.name, "qx": qx, "qy": qy, "backend": signer.name}
        resp = requests.post(f"{app}/api/device", json=body, timeout=30)
        resp.raise_for_status()
        info = resp.json()
        state = "paired" if info.get("paired") else "pairing…"
        print(f"[{signer.name}] announced to {app} -> {state}" + (f" (tx {info['txHash']})" if info.get("txHash") else ""))
        return info

    last_announce = 0
    seen_failed = set()
    while True:
        try:
            if time.time() - last_announce > 30:
                announce()
                last_announce = time.time()
            resp = requests.get(f"{app}/api/requests", params={"status": "pending"}, timeout=15)
            resp.raise_for_status()
            pending = [r for r in resp.json().get("requests", []) if r["id"] not in seen_failed]
            for req in pending:
                print(
                    f"\n[{signer.name}] request {req['id']}: send {req['amountFormatted']} {req['tokenSymbol']} "
                    f"to {req.get('toName') or req['to']}\n  digest {req['digest']}"
                )
                if not wait_for_approval(args, req):
                    print("  skipped")
                    seen_failed.add(req["id"])
                    continue
                t0 = time.time()
                r, s = signer.sign_digest(hexbytes(req["digest"], 32))
                print(f"  signed in {1000 * (time.time() - t0):.0f} ms\n  r {r:064x}\n  s {s:064x}")
                body = {"r": "0x%064x" % r, "s": "0x%064x" % s, "qx": qx, "qy": qy}
                post = requests.post(f"{app}/api/requests/{req['id']}/signature", json=body, timeout=120)
                if post.ok:
                    out = post.json()
                    print(f"  -> {out.get('status')}" + (f"  tx {out['txHash']}" if out.get("txHash") else ""))
                else:
                    print(f"  -> app rejected signature: {post.status_code} {post.text[:200]}")
                    seen_failed.add(req["id"])
            if args.once and pending:
                return
        except KeyboardInterrupt:
            print("\nbye")
            return
        except Exception as e:  # network blips should not kill the daemon
            print(f"[{signer.name}] error: {e}", file=sys.stderr)
            last_announce = 0
        time.sleep(args.interval)


def main():
    sys.stdout.reconfigure(line_buffering=True)  # logs show up immediately under systemd / redirects
    # shared flags work before or after the subcommand: `signer.py --mock run` == `signer.py run --mock`
    common = argparse.ArgumentParser(add_help=False)
    S = argparse.SUPPRESS  # absent flags set nothing, so a flag given at either level wins
    common.add_argument("--mock", action="store_true", default=S, help="use a software P-256 key instead of the chip")
    common.add_argument("--mock-key", default=S, help="hex private scalar for a deterministic mock key (tests)")
    common.add_argument("--i2c-bus", type=int, default=S)
    common.add_argument("--i2c-addr", default=S, help="7-bit I2C address (0x60 generic, 0x35 TNG/TrustFLEX)")
    common.add_argument("--slot", type=int, default=S)
    common.add_argument("--raw", action="store_true", default=S, help="print bare hex (for forge ffi)")
    defaults = {"mock": False, "mock_key": None, "i2c_bus": 1, "i2c_addr": "0x60", "slot": 0, "raw": False}

    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, parents=[common]
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pubkey", parents=[common])
    sp = sub.add_parser("sign", parents=[common])
    sp.add_argument("--digest", required=True)
    rp = sub.add_parser("run", parents=[common])
    rp.add_argument("--app", default=os.environ.get("CHIP_APP_URL", "http://localhost:3000"))
    rp.add_argument("--name", default=os.environ.get("CHIP_DEVICE_NAME", "pi-atecc608"))
    rp.add_argument("--interval", type=float, default=1.0)
    rp.add_argument("--confirm", action="store_true", help="ask on the terminal before signing")
    rp.add_argument("--button", type=int, help="wait for a button press on this BCM GPIO before signing")
    rp.add_argument("--once", action="store_true", help="exit after handling one batch")
    args = p.parse_args()
    for k, v in defaults.items():
        if not hasattr(args, k):
            setattr(args, k, v)
    {"pubkey": cmd_pubkey, "sign": cmd_sign, "run": cmd_run}[args.cmd](args)


if __name__ == "__main__":
    main()
