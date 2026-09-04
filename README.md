# ATECC608 demo — hardware-signed stablecoin transfers

A Raspberry Pi with an ATECC608 secure element signs a USDS transfer. A relay pays the gas.
A smart contract verifies the chip's P-256 signature and moves the funds. Nobody ever sees the key.

```
browser  -> app: "send 5 USDS to atg.eth"
app      -> builds EIP-712 digest {token, to, amount, nonce, deadline}
Pi       <- polls the app, signs the digest inside the ATECC608, posts (r, s)
relay    -> ChipAccount.executeTransfer(...)   (relay pays gas, holds nothing)
contract -> P256.verify(digest, r, s, chipPubKey) -> USDS.transfer(to, amount)
```

Two folders:

- **`app/`** — Scaffold-ETH 2 (Foundry flavour, from ethskills.com). Contracts, tests, Next.js UI, and
  the queue + relay as Next.js route handlers.
- **`pi/`** — the signer that runs on the Pi. Has a `--mock` mode so the whole loop runs with no hardware.

## Run it (three terminals + the Pi)

```bash
cd app && yarn install
yarn chain                      # 1. anvil
yarn deploy                     # 2. ChipAccount + MockUSDS (1,000 USDS minted into the vault)
yarn start                      # 3. http://localhost:3000
```

Then the signer, from a Pi (or this machine in mock mode):

```bash
cd pi && pip3 install -r requirements.txt
python3 signer.py run --mock --app http://localhost:3000          # no chip yet
python3 signer.py run --app http://<mac-ip>:3000 --i2c-addr 0x60  # real chip, see pi/README.md
```

Open **/setup** and walk the four steps: lock the chip's config zone (once, real chip only), generate a
key, pair it with the vault, fund the vault. The browser queues each job, the Pi runs it and reports
back. Then on **Send** type `atg.eth` and `5`, press **Send to chip**, and watch
Requested → Signed on chip → Relayed → Confirmed.

## You have a fresh chip? Read this first

![Adafruit ATECC608 breakout on a Raspberry Pi 3 B+](docs/pi-atecc608.jpg)

A new ATECC608 breakout is blank and unlocked, and **an unlocked ATECC608 refuses to make a key or
sign** (every crypto command returns `0xF4`). You must lock its **config zone** once. That is
permanent, and it is normal: every chip in use is config-locked. It does not put a key in and does
not stop you making new keys later. The **data zone stays unlocked**, so "Generate a new key" works
forever.

The full walkthrough with real outputs from the chip we did this to is in
**[`pi/README.md`](pi/README.md)**. Short version:

1. Wire SDA/SCL/3V3/GND, find it at I2C `0x60`.
2. `pip3 install --user --break-system-packages cryptoauthlib requests cryptography`
3. `./start.sh http://<laptop-ip>:3000 --i2c-addr 0x60 --allow-lock`
4. In the app, /setup: **Lock config zone** → **Generate key** → **Pair key** → **Mint into vault**.
5. /send: 5 USDS to `atg.eth`. The chip signs in ~100 ms; the relay settles it.

Verified 2026-09-04 on an ATECC608A (Adafruit STEMMA QT breakout, Raspberry Pi 3 B+): locked
config, generated a key, paired, signed, settled onchain, data zone never locked.

## Why P-256

The ATECC608 only does NIST P-256 (secp256r1). Ethereum's `ecrecover` is secp256k1, so the chip can't
be a normal EOA. Instead `ChipAccount` is a small vault contract whose owner is a P-256 public key.
Verification uses OpenZeppelin's `P256` library: the RIP-7212 / EIP-7951 precompile where the chain has
it (mainnet since Fusaka, Base, Optimism, Arbitrum, Polygon), pure Solidity otherwise. Local anvil works
either way; the tests run at ~110k gas per transfer.

## What's where

| Path | What |
|------|------|
| `app/packages/foundry/contracts/ChipAccount.sol` | vault owned by a P-256 key; `executeTransfer` verifies + transfers; nonce + deadline replay protection |
| `app/packages/foundry/contracts/MockUSDS.sol` | 18-decimal play USDS for localhost |
| `app/packages/foundry/script/DeployChipDemo.s.sol` | deploy; env `CHIP_PUBKEY_X/Y`, `CHIP_ADMIN`, `USDS_ADDRESS` |
| `app/packages/foundry/test/ChipAccount.t.sol` | 12 tests; signatures come from `pi/signer.py --mock` over ffi |
| `app/packages/nextjs/app/page.tsx` | Send: device / vault / relay status, send form, transfer timeline |
| `app/packages/nextjs/app/setup/page.tsx` | Setup: lock config, generate key, pair, fund |
| `app/packages/nextjs/app/api/*` | `device` (announce), `commands` (jobs for the Pi), `pair` (setSigner), `fund` (local mint), `requests` (queue + digest), `requests/[id]/signature` (verify + relay), `state` |
| `app/packages/nextjs/services/chip/*` | JSON-file store, chain clients, relay |
| `pi/signer.py` | announce, run setup jobs (status / genkey / lock-config), poll, sign, post. `--mock`, `--confirm`, `--button`, `--allow-lock` |
| `pi/start.sh` | background the signer on the Pi (pid file + log) |
| `pi/provision.py` | CLI fallback for the setup steps (config lock + GenKey; data zone left unlocked) |
| `pi/README.md` | **the fresh-chip guide**: what locking means, every step with real outputs, every error |

## Trust model

- The chip key is the only thing that can spend the vault. The relay just pays gas and can only refuse.
- Each signature covers token, recipient, amount, nonce, deadline, chain id and contract address.
  Replays and tampering fail (`test_replayIsRejected`, `test_tamperedAmountIsRejected`, …).
- `admin` (the deployer) can re-pair a new chip key. That is a demo convenience; for real money hand it
  to a multisig or burn it.

## Live chain

1. `yarn generate` / `yarn account:import`, fund the deployer.
2. In `app/packages/foundry/.env`: `USDS_ADDRESS=<token>`, optionally `CHIP_PUBKEY_X/Y` from
   `python3 pi/signer.py pubkey`.
3. `yarn deploy --network <net>` and `yarn verify --network <net>`.
4. In `app/packages/nextjs/.env.local`: `RELAYER_PRIVATE_KEY=<funded key>` (the deployer's if you want
   auto-pairing), `USDS_ADDRESS=<token>`.
5. `targetNetworks` in `scaffold.config.ts`, then `yarn start`.

The relay's key stays in `.env.local` and is gitignored. Never put it anywhere else.
