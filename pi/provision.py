#!/usr/bin/env python3
"""
One-time ATECC608 provisioning: write Microchip's reference config, lock the config zone,
generate a P-256 key in slot 0, lock the data zone.

    python3 provision.py --i2c-addr 0x60          # dry run: shows what it would do
    python3 provision.py --i2c-addr 0x60 --yes    # actually provision

*** IRREVERSIBLE. Locking is permanent. A locked chip cannot be reconfigured. ***
Breakout boards from Adafruit/SparkFun ship UNLOCKED and must be provisioned once.
Microchip TrustFLEX / Trust&Go (TNG) parts ship locked with a key already in slot 0 — skip this script.

Config (Microchip's ATECC608 reference from cryptoauthlib test/api_calib/test_calib_config.c):
  slot 0  P-256 private key, external signing enabled, GenKey allowed   <- the wallet key
  slot 1..7 more private key slots, 8 general data, 9.. certificates etc.
"""
import argparse
import sys

# 128-byte config zone. Bytes 0-15 (serial, revision) and 84-87 (lock bytes) are read-only;
# cryptoauthlib skips them when writing.
ATECC608_CONFIG = bytes([
    0x01, 0x23, 0x00, 0x00, 0x00, 0x00, 0x60, 0x00, 0x04, 0x05, 0x06, 0x07, 0xEE, 0x01, 0x01, 0x00,
    0xC0, 0x00, 0xA1, 0x00, 0xAF, 0x2F, 0xC4, 0x44, 0x87, 0x20, 0xC4, 0xF4, 0x8F, 0x0F, 0x0F, 0x0F,
    0x9F, 0x8F, 0x83, 0x64, 0xC4, 0x44, 0xC4, 0x64, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F,
    0x0F, 0x0F, 0x0F, 0x0F, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
    0x00, 0x00, 0x00, 0x00, 0xFF, 0x84, 0x03, 0xBC, 0x09, 0x69, 0x76, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x0E, 0x40, 0x00, 0x00, 0x00, 0x00,
    0x33, 0x00, 0x1C, 0x00, 0x13, 0x00, 0x1C, 0x00, 0x3C, 0x00, 0x3A, 0x10, 0x1C, 0x00, 0x33, 0x00,
    0x1C, 0x00, 0x1C, 0x00, 0x38, 0x00, 0x30, 0x00, 0x3C, 0x00, 0x3C, 0x00, 0x32, 0x00, 0x30, 0x00,
])
assert len(ATECC608_CONFIG) == 128


def check(cal, status, what):
    if status != cal.ATCA_SUCCESS:
        sys.exit(f"{what} failed: 0x{status:02X}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--i2c-bus", type=int, default=1)
    p.add_argument("--i2c-addr", default="0x60", help="7-bit address (0x60 for most breakouts)")
    p.add_argument("--slot", type=int, default=0)
    p.add_argument("--yes", action="store_true", help="really write and LOCK the chip")
    args = p.parse_args()

    import cryptoauthlib as cal

    cal.load_cryptoauthlib()
    cfg = cal.cfg_ateccx08a_i2c_default()
    cfg.cfg.atcai2c.bus = args.i2c_bus
    cfg.cfg.atcai2c.address = int(args.i2c_addr, 0) << 1
    cfg.devtype = cal.get_device_type_id("ATECC608")
    check(cal, cal.atcab_init(cfg), "atcab_init")

    rev = bytearray(4)
    check(cal, cal.atcab_info(rev), "atcab_info")
    sn = bytearray(9)
    check(cal, cal.atcab_read_serial_number(sn), "read serial")
    print(f"device revision {rev.hex()}  serial {sn.hex()}")

    cfg_locked = cal.AtcaReference(False)
    data_locked = cal.AtcaReference(False)
    check(cal, cal.atcab_is_locked(cal.LOCK_ZONE_CONFIG, cfg_locked), "is_locked(config)")
    check(cal, cal.atcab_is_locked(cal.LOCK_ZONE_DATA, data_locked), "is_locked(data)")
    print(f"config zone locked: {bool(cfg_locked.value)}   data zone locked: {bool(data_locked.value)}")

    if bool(cfg_locked.value) and bool(data_locked.value):
        pub = bytearray(64)
        check(cal, cal.atcab_get_pubkey(args.slot, pub), "get_pubkey")
        print(f"already provisioned. slot {args.slot} public key:\n  qx 0x{pub[:32].hex()}\n  qy 0x{pub[32:].hex()}")
        return

    if not args.yes:
        print("\nDRY RUN. Would:")
        if not bool(cfg_locked.value):
            print("  1. write the 128-byte reference config   2. LOCK the config zone (permanent)")
        if not bool(data_locked.value):
            print(f"  3. GenKey -> new P-256 key in slot {args.slot}   4. LOCK the data zone (permanent)")
        print("Re-run with --yes to do it.")
        return

    if not bool(cfg_locked.value):
        check(cal, cal.atcab_write_config_zone(ATECC608_CONFIG), "write_config_zone")
        check(cal, cal.atcab_lock_config_zone(), "lock_config_zone")
        print("config written and locked")

    pub = bytearray(64)
    check(cal, cal.atcab_genkey(args.slot, pub), f"genkey slot {args.slot}")
    print(f"generated P-256 key in slot {args.slot}")

    if not bool(data_locked.value):
        check(cal, cal.atcab_lock_data_zone(), "lock_data_zone")
        print("data zone locked")

    print(f"\nslot {args.slot} public key:\n  qx 0x{pub[:32].hex()}\n  qy 0x{pub[32:].hex()}")
    print("\nnow run: python3 signer.py run --app http://<mac-ip>:3000")


if __name__ == "__main__":
    main()
