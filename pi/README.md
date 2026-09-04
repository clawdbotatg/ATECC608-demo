# pi/ — the signer, and what to do with a brand-new ATECC608

This folder runs on a Raspberry Pi with an ATECC608 secure element on I2C. The chip holds the
P-256 private key that owns the vault contract. Nothing here touches the chain: the Pi signs
32-byte digests and talks HTTP to the app.

```
app (Mac)  --request {to, amount, digest}-->  Pi  --{r, s}-->  app relay  --tx-->  ChipAccount.executeTransfer
app (Mac)  --setup job {status | genkey | lock-config}-->  Pi  --result-->  app
```

If you are a person or a bot with a fresh chip in your hand, read **"You just got a chip"** first.
Everything in it was done for real on 2026-09-04 with an ATECC608A on a Pi (serial
`01235e6763cc8d97ee`); the outputs shown are what the real run printed.

![Adafruit ATECC608 breakout on a Raspberry Pi 3 B+](../docs/pi-atecc608.jpg)

**The hardware in the photo:** Raspberry Pi 3 Model B+ · Adafruit ATECC608 STEMMA QT breakout
(the black board, green power LED on) · a 4-wire STEMMA QT / JST-SH cable to the Pi's header for
Vcc, GND, SDA, SCL. Any Pi with I2C and any ATECC608A/B breakout works the same.

---

## You just got a chip

### What a fresh chip is

A breakout-board ATECC608 (Adafruit, SparkFun, generic "ATECC608A" boards) ships **blank and
unlocked**:

- **config zone unlocked** — the 128-byte table that says what each of the 16 key slots is for
  is still editable.
- **data zone unlocked** — the slots themselves are still writable in the clear.
- **no key anywhere.**

Here is the catch that surprises everyone: **an unlocked ATECC608 will not generate a key and will
not sign.** Every crypto command returns execution error `0xF4` until the config zone is locked.
This is by design. The chip wants its rules frozen before it will hold a secret.

Verified on this chip before locking:

```
$ python3 -c "import signer; s=signer.AteccSigner(addr7=0x60); print(s.status())"
{'serial': '01235e6763cc8d97ee', 'revision': '00006002', 'configLocked': False, 'dataLocked': False, 'slot': 0, 'hasKey': False}
$ ... atcab_genkey(0, pub) -> 0xfffffff4        # ATCA_EXECUTION_ERROR: chip refuses, config not locked
```

### The two locks, and which one you do

| Zone | What locking does | Reversible? | This demo |
|------|-------------------|-------------|-----------|
| **Config** | Freezes the slot table: slot 0 = P-256 private key, may sign external digests, GenKey allowed. | **No. Permanent.** | **Lock it.** Required to do anything. |
| **Data** | Freezes slot contents. After this, GenKey on a slot is only allowed if the config says so, and clear-text writes stop. | No. Permanent. | **Leave it unlocked.** You can run GenKey again any time and get a fresh key. |

"Permanent" sounds scary. It is normal: every ATECC608 in a product is config-locked. Locking the
config zone does not put a key in, does not choose a key, and does not stop you from making new keys
later. It only fixes *what kind of thing* each slot is. Microchip's own pre-provisioned parts
(TrustFLEX, Trust&Go) arrive config-locked *and* data-locked with a key already in slot 0.

The config we write is Microchip's ATECC608 reference config from cryptoauthlib
(`test/api_calib/test_calib_config.c`), embedded in `signer.py` as `AteccSigner.CONFIG`. Slot 0:
P-256 private key, external signing enabled, GenKey allowed. Slots 1-7 more private keys, 8 general
data, 9-15 certificates and public keys. Bytes 0-15 (serial, revision) and 84-87 (lock bytes) are
read-only; cryptoauthlib skips them.

### Step by step

**0. Wire it** (breakout to Pi 40-pin header; STEMMA QT cable colours in brackets)

| Breakout | Pi header |
|----------|-----------|
| VIN / VCC (red) | 3V3 (pin 1) |
| GND (black) | GND (pin 6) |
| SDA (blue) | GPIO2 / SDA (pin 3) |
| SCL (yellow) | GPIO3 / SCL (pin 5) |

Enable I2C: `sudo raspi-config` → Interface Options → I2C → enable → reboot. If you can't sudo,
check `ls /dev/i2c-1` exists; on Raspberry Pi OS / Debian it usually is.

**1. Find it on the bus.** With i2c-tools: `i2cdetect -y 1`. Without (no sudo to apt):

```bash
python3 - <<'PY'
import os, fcntl
fd = os.open('/dev/i2c-1', os.O_RDWR); found = []
for a in range(0x03, 0x78):
    try: fcntl.ioctl(fd, 0x0703, a); os.write(fd, b''); found.append(hex(a))
    except OSError: pass
print(found)
PY
```

Expect `0x60` (most breakouts) or `0x35` (TrustFLEX / Trust&Go). The chip sleeps between commands
and may not show every time; run it twice. Ours: `['0x39', '0x60']` (0x39 was something else on the
board).

**2. Install.** Python 3.11+ on the Pi.

```bash
git clone https://github.com/clawdbotatg/ATECC608-demo ~/ATECC608-demo
cd ~/ATECC608-demo/pi
pip3 install --user --break-system-packages cryptoauthlib requests cryptography
python3 -c "import cryptoauthlib as c; c.load_cryptoauthlib(); print('ok')"
```

The `cryptoauthlib` wheel on PyPI carried a working `libcryptoauth.so` for a 64-bit Pi (Debian 13,
aarch64, Python 3.13). If `load_cryptoauthlib()` fails, build it:

```bash
git clone https://github.com/MicrochipTech/cryptoauthlib && cd cryptoauthlib
cmake -B build -DATCA_HAL_I2C=ON -DATCA_ATECC608_SUPPORT=ON -DATCA_BUILD_SHARED_LIBS=ON
cmake --build build -j4 && sudo cmake --install build && sudo ldconfig
```

**3. Talk to it.** Read-only; safe on any chip.

```bash
python3 -c "import signer; print(signer.AteccSigner(bus=1, addr7=0x60).status())"
# {'serial': '01235e67…', 'revision': '00006002', 'configLocked': False, 'dataLocked': False, 'slot': 0, 'hasKey': False}
```

`revision 00006002` = ATECC608A. `00006003` = ATECC608B. Both work the same here.

**4. Start the signer, pointed at the app.** The app runs on your laptop (see the root README:
`yarn chain`, `yarn deploy`, `yarn dev -p 3000`). Use the laptop's LAN IP.

```bash
./start.sh http://192.168.1.50:3000 --i2c-addr 0x60 --allow-lock
tail -f signer.log
```

`--allow-lock` is only needed for step 5. Without it the signer refuses the lock command, so a
stray click can't lock a chip you meant to keep blank.

The log on a fresh chip:

```
[atecc608] no key: config zone is not locked; the chip has no usable key yet (Setup page, step 1)
[atecc608] announced to http://192.168.1.50:3000 -> no key (Setup page)
```

**5. Lock the config zone.** Open the app's **/setup** page. The Device card shows the real chip:
serial, `config zone unlocked · data zone unlocked`. Step 1 has a **Lock config zone** button. Click
it, confirm. The browser queues the job; the Pi picks it up within a second:

```
[atecc608] command lock-config (mtnkpdmw-h8dxrq)
  config zone locked (data zone left unlocked)
  done
[atecc608] no key: atcab_get_pubkey failed: 0xF4        <- slot 0 is still empty, expected
```

That is the one permanent step. Done.

**6. Generate the key.** Step 2, **Generate key**. The chip makes a P-256 key inside slot 0 and
returns only the public half:

```
[atecc608] command genkey (mtnkprsl-lcux7u)
  new key
  qx 0xe894cec7682c9ded169f5e137befe9aab54f7e595700bae943088f8123192718
  qy 0x03e681f87a1044a882d57596580adc592fce6a9ef0182b1360c95fc7d312433f
  done
[atecc608] announced to http://192.168.1.50:3000 -> not paired (Setup page -> Pair key)
```

Because the data zone is unlocked you can press this again any time and get a different key.

**7. Pair.** Step 3, **Pair key**. The app's relay calls `setSigner(qx, qy)` on the vault contract.
From now on only this chip can spend from it.

**8. Fund.** Step 4, **Mint into vault** (localhost) or send real tokens to the vault address.

**9. Send.** Go to **Send**, type `atg.eth` and `5`, press **Send to chip**:

```
[atecc608] request mtnkq95q-tgd6tb: send 5 USDS to atg.eth
  digest 0xb55d28f82e10532c492cc0d614930ad7feacd11eba982f4206b31986727f2c1b
  signed in 106 ms
  r 7908a23c17610521b8f815233f1e72f1900d885aef12a7ae8176fd70b553c6f4
  s 2a0e3f638cea6d47fa7f48374fca4a1818d36d6eeb5b8a052306db66208efa50
  -> confirmed  tx 0x0a5374e51b46f81833edeb6ddbd1f6918a471efaa59e15faca2c069aabdf6827
```

The chip signed in 106 ms. The relay paid ~60k gas. The contract verified the P-256 signature and
moved the tokens. Signing works with the data zone unlocked; you do not need to lock it.

### Second chip, or starting over

- **Another fresh chip:** repeat steps 3-7. Each chip gets its own key; pair whichever is plugged in.
- **New key on the same chip:** Setup → Generate a new key → Pair. Old key stops working the
  moment you pair the new one.
- **Pre-locked part (TrustFLEX / Trust&Go, I2C 0x35):** skip step 5; it is already config- and
  data-locked with a key in slot 0. Start at step 4 with `--i2c-addr 0x35`, then Pair.
- **You locked config and regret it:** you can't undo it, but there's nothing to regret. Keys are
  still regenerable. The only thing frozen is "slot 0 is a P-256 signing key".

### Errors you will actually see

| Message | Meaning |
|---------|---------|
| `atcab_init failed: 0x…` | Wrong wiring, wrong bus, wrong `--i2c-addr`, or I2C not enabled. |
| `… failed: 0xF4` | `ATCA_EXECUTION_ERROR`. Config zone not locked (GenKey/Sign refused), or reading a public key from an empty slot. |
| `refused: start signer.py with --allow-lock …` | You clicked Lock config without the flag. Restart the signer with `--allow-lock`. |
| `config zone is not locked; the chip has no usable key yet` | Normal on a fresh chip. Do step 5. |
| `ModuleNotFoundError: cryptoauthlib` | Step 2. |
| `attribute 'ATCA_SUCCESS'` / `'LOCK_ZONE_CONFIG'` | Old copy of `signer.py`. `git pull`. The Python binding keeps these under `Status` and doesn't export zone ids; `signer.py` handles it. |

---

## Running without a chip

```bash
python3 signer.py run --mock --app http://localhost:3000
```

`--mock` uses a software P-256 key in `.mock_key.pem` (gitignored). Same code path, same low-s
normalisation, same HTTP calls, same setup jobs (lock is a no-op). The Foundry tests call it over ffi.

## Files

| File | What |
|------|------|
| `signer.py` | The daemon. `run` announces the chip, runs setup jobs, signs requests. `pubkey` / `sign` are one-shots. `--mock`, `--confirm` (ask on the terminal), `--button 17` (GPIO button), `--allow-lock`. |
| `start.sh` | `./start.sh <app-url> [flags]` — restarts the daemon in the background, pid in `signer.pid`, log in `signer.log`. |
| `provision.py` | CLI fallback for steps 5-6 without the app. `--yes` to actually lock config + GenKey. `--lock-data` only if you really want the data zone locked too. |
| `requirements.txt` | pip deps. |

## Notes for the curious

- The ATECC608 signs a raw 32-byte digest. It does not hash. The app hands it the finished EIP-712
  digest, the same bytes the contract recomputes.
- ECDSA has two valid `s` per signature. The contract (OpenZeppelin `P256`) accepts only the low one,
  so the signer normalises `s > n/2` to `n - s`. The relay does it again, defensively.
- A request expires 10 minutes after it is created. Sign it or it is dropped.
- `--i2c-addr` is the 7-bit address. cryptoauthlib wants it shifted left one bit; `signer.py` does
  that, and finds the field whether the binding calls it `address`, `slave_address`, or hides it in
  a union `u`.
- The Pi never opens a port. It only makes outbound HTTP to the app, so it works from behind any
  WiFi with no config.
