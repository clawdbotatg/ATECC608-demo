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

## It ran on mainnet

![5 USDS to atg.eth, signed by the chip, settled on Ethereum mainnet](docs/mainnet-send.png)

2026-09-04. Vault [`0x0336aD6afc8bE414D6BD1f7A16caEb14BCCd16e9`](https://etherscan.io/address/0x0336aD6afc8bE414D6BD1f7A16caEb14BCCd16e9)
(verified source), real [USDS](https://etherscan.io/token/0xdC035D45d973E3EC169d2276DDab16f1e407384F).

| Step | Tx | Notes |
|------|----|-------|
| Deploy `ChipAccount` with the chip's key baked in | [`0xa5d10ea4…`](https://etherscan.io/tx/0xa5d10ea42dfff94a6437ace48cc1440b21749dbe37e171863e8a79347369c805) | `yarn deploy --network mainnet`, 0.000056 ETH |
| 10 USDS into the vault | [`0xb85ad3ff…`](https://etherscan.io/tx/0xb85ad3fff1585504f6866d538abb0653b7e7293c4de7a9e2871d9b5a1a94bf88) | plain ERC-20 transfer from a wallet |
| **5 USDS to atg.eth, signed by the ATECC608** | [`0x7a977bea…`](https://etherscan.io/tx/0x7a977bea22e648d4173fc76cdfce2242ede6ff525b3c15590ef109561aa94b9a) | chip signed in 106 ms, 1.8 s after the click; 81,715 gas paid by the relay; confirmed 14 s after the click |

Chip: ATECC608A on an Adafruit STEMMA QT breakout, Raspberry Pi 3 B+, serial `01235e6763cc8d97ee`,
key in slot 0. The private key has never existed outside that chip. The relay
(`0x7FE7f508A267BF45D2D161F244DbB12743e2cf49`) is a throwaway foundry keystore account that holds
0.003 ETH for gas and can't spend the vault.

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

## Live chain (what we did for mainnet)

One account is deployer, contract admin, and relay. It lives as an encrypted foundry keystore; no raw
key in any file.

```bash
# 1. account. Password goes in a file only; the key never prints.
PW=$(openssl rand -hex 24); umask 077; printf '%s' "$PW" > ~/.foundry/keystores/atecc-relay.password.txt
cast wallet new ~/.foundry/keystores --unsafe-password "$PW"     # prints the address; rename the file to atecc-relay
# send it ~0.003 ETH

# 2. app/packages/foundry/.env
USDS_ADDRESS=0xdC035D45d973E3EC169d2276DDab16f1e407384F
CHIP_PUBKEY_X=0x…   CHIP_PUBKEY_Y=0x…      # from the Setup page or `python3 pi/signer.py pubkey`

# 3. deploy + verify with Scaffold-ETH. ETH_PASSWORD is the password *file* path.
cd app
ETH_PASSWORD=$HOME/.foundry/keystores/atecc-relay.password.txt yarn deploy --network mainnet --keystore atecc-relay
yarn verify --network mainnet

# 4. app/packages/nextjs/.env.local
NEXT_PUBLIC_TARGET_NETWORK=mainnet
RELAYER_KEYSTORE=atecc-relay
RELAYER_KEYSTORE_PASSWORD_FILE=/Users/you/.foundry/keystores/atecc-relay.password.txt
USDS_ADDRESS=0xdC035D45d973E3EC169d2276DDab16f1e407384F

yarn dev -p 3000
```

Send USDS to the vault address the deploy printed. The Pi needs no change: the EIP-712 domain picks up
chain id 1 from the app. Type a recipient and amount, Send to chip, done.

Because the deploy baked in `CHIP_PUBKEY_X/Y`, no Pair step was needed. Generate a new key later and
the Pair button still works: the relay is the admin.

Gotcha: in foundry 1.7 the env var `ETH_PASSWORD` is the path to a password *file*, not the password.
Passing the password itself makes foundry print it in an error. Rotate with `cast wallet change-password`
if that happens (we did).

Everything secret is gitignored: `.env`, `.env.local`, the keystore and its password file live in
`~/.foundry/keystores`.
