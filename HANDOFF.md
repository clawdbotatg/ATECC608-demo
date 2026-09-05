# HANDOFF — read this first if you are the next agent (or future me)

Written 2026-09-04, end of day one. Everything below was done and verified that day. No secrets in
this file. Secrets live only in gitignored files on Austin's Mac; their *locations* are listed.

## What this is, in one paragraph

A Raspberry Pi with an ATECC608A secure element holds a P-256 key. That key owns a vault contract
(`ChipAccount`) on Ethereum mainnet that holds real USDS. A Next.js app (Scaffold-ETH 2) lets Austin
type "5 USDS to atg.eth"; the app builds an EIP-712 digest, the Pi polls it, the chip signs it, the
Pi posts the signature back, the app's relay pays gas and calls `executeTransfer`, the contract
verifies the P-256 signature (EIP-7951 precompile) and moves the tokens. Two mainnet sends have
happened. The private key has never existed outside the chip.

## State of the world right now

| Thing | State | Where |
|---|---|---|
| Vault contract | live, verified, ~19.5 USDS inside, nonce 4 | mainnet `0x0336aD6afc8bE414D6BD1f7A16caEb14BCCd16e9` |
| Token | real USDS, 18 decimals | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` |
| Relay / deployer / contract admin | one EOA, ~0.0029 ETH | `0x7FE7f508A267BF45D2D161F244DbB12743e2cf49`, foundry keystore `atecc-relay` |
| Chip #1 | ATECC608A, config zone LOCKED, data zone unlocked, P-256 key in slot 0, paired to the vault | on the Pi, I2C 0x60, serial `01235e6763cc8d97ee` |
| Chip #2 | blank, unlocked. **Do not lock without asking Austin.** | in Austin's drawer |
| Pi signer | running (restarted 2026-09-05 morning) | `~/ATECC608-demo/pi` on the Pi |
| Next.js app | running on Austin's Mac, mainnet mode | http://localhost:3000, LAN http://<mac-ip>:3000 |
| anvil | may still be running from earlier local testing, harmless | port 8545 on the Mac |
| Repo | all pushed, tree clean | github.com/clawdbotatg/ATECC608-demo |
| Audit | onedollaraudit #814, no outside theft path | linked in README, table of findings + responses |

## Machines and access

- **Mac** (this box): repo at `~/clawd/clawd-harness/projects/ATECC608-demo`. LAN IP: `ipconfig getifaddr en0`
  (check with `ipconfig getifaddr en0`).
- **Pi**: `ssh <pi-user>@<pi-ip>` (hostname on your LAN). Key login works from the Mac, no password
  needed. There is an account password; it is NOT written anywhere and must never be. `sudo` needs it,
  so avoid sudo. `pip3 install --user --break-system-packages` works without it.
- Repo clone on the Pi: `~/ATECC608-demo`. Keep it in sync with `git pull` after pushing.

## Secrets: what exists and where (never commit, never print)

| Secret | Location | Notes |
|---|---|---|
| Relay private key | `~/.foundry/keystores/atecc-relay` (encrypted v3 keystore) | never decrypted to a file |
| Its password | `~/.foundry/keystores/atecc-relay.password.txt` | rotated once after a foundry error echoed it into a session log |
| App env (mainnet switch, keystore name, password *file path*, USDS address) | `app/packages/nextjs/.env.local` | gitignored |
| Foundry env (Alchemy + Etherscan keys = SE2's shared defaults, `USDS_ADDRESS`, `CHIP_PUBKEY_X/Y`) | `app/packages/foundry/.env` | gitignored |
| Mock signer software key | `pi/.mock_key.pem` | gitignored, only for `--mock` |
| Pi account password | Austin's head | not ours to store |

A global gitleaks pre-commit hook runs on every commit. On 2026-09-04 I added exact-literal allowlist
entries to `~/.config/gitleaks/gitleaks.toml` for Scaffold-ETH template values (anvil dev key #9,
SE2's shared Alchemy key, two token addresses, the vendored yarn binary). Backup at
`gitleaks.toml.bak-2026-09-04`. If a commit is blocked, read the finding; do not `--no-verify`.

## How to run each piece

### Demo again tomorrow (mainnet)

```bash
# 1. app on the Mac (probably still running; if not:)
cd ~/clawd/clawd-harness/projects/ATECC608-demo/app/packages/nextjs
env -u PORT yarn dev -p 3000          # the harness shell exports PORT=8787; must override

# 2. signer on the Pi
ssh <pi-user>@<pi-ip> '~/ATECC608-demo/pi/start.sh http://<mac-ip>:3000 --i2c-addr 0x60'
ssh <pi-user>@<pi-ip> 'tail -f ~/ATECC608-demo/pi/signer.log'

# 3. browser: http://localhost:3000  -> atg.eth, 5, Send to chip
```

Add `--confirm` (terminal yes/no) or `--button 17` (GPIO button) to `start.sh` if you want a physical
approval step. Add `--allow-lock` only when you intend to lock a chip.

### Back to localhost

```bash
cd app && yarn chain            # anvil
yarn deploy                     # MockUSDS + ChipAccount on 31337, 1000 USDS minted into the vault
# blank NEXT_PUBLIC_TARGET_NETWORK in packages/nextjs/.env.local (or delete the line), then:
cd packages/nextjs && env -u PORT yarn dev -p 3000
cd ../../../pi && python3 signer.py run --mock --app http://localhost:3000   # or the real Pi at the Mac's IP
```

`/setup` page: lock config (skipped for mock) -> generate key -> pair -> mint. On localhost the relay is
anvil account #9 via `eth_sendTransaction` (no key anywhere), which is also the deployer, so Pair works.

### Tests

```bash
cd app/packages/foundry && forge test     # 12 tests; signatures come from ../../../pi/signer.py --mock over ffi
cd app && yarn workspace @se-2/nextjs check-types && yarn workspace @se-2/nextjs lint
```

### Redeploy to mainnet (new vault)

```bash
cd app
ETH_PASSWORD=$HOME/.foundry/keystores/atecc-relay.password.txt yarn deploy --network mainnet --keystore atecc-relay
yarn verify --network mainnet
```

`CHIP_PUBKEY_X/Y` in `packages/foundry/.env` bake the chip key in so no Pair is needed. `yarn deploy`
rewrites `packages/nextjs/contracts/deployedContracts.ts` (address + `deployedOnBlock`); commit it.
Everything in the app resolves addresses from that file. Nothing is hardcoded.

## Code map

```
app/packages/foundry/contracts/ChipAccount.sol   vault. signerX/Y, admin, nonce. executeTransfer(token,to,amount,deadline,r,s)
                                                 EIP-712 "ChipAccount" v1. OpenZeppelin P256.verify (precompile 0x100, Solidity fallback)
app/packages/foundry/contracts/MockUSDS.sol      localhost only, anyone can mint
app/packages/foundry/script/DeployChipDemo.s.sol env: CHIP_PUBKEY_X/Y, CHIP_ADMIN, USDS_ADDRESS
app/packages/foundry/test/ChipAccount.t.sol      replay, tamper, wrong key, expiry, unpaired, fuzz, known-answer vector

app/packages/nextjs/app/page.tsx                 Send page. Transfers list = TransferExecuted events (useScaffoldEventHistory)
                                                 merged with local in-flight rows
app/packages/nextjs/app/setup/page.tsx           Setup page: lock / genkey / pair / fund. Drives the Pi via the command queue
app/packages/nextjs/app/api/device               Pi announces key + chip status (POST), read (GET)
app/packages/nextjs/app/api/commands             browser queues jobs (POST), Pi polls (GET); [id]/result = Pi reports back
app/packages/nextjs/app/api/pair                 relay calls setSigner(device key)
app/packages/nextjs/app/api/fund                 localhost: mint MockUSDS into the vault
app/packages/nextjs/app/api/requests             POST: build digest (viem hashTypedData, cross-checked with the contract), queue
                                                 GET ?status=pending: what the Pi signs
app/packages/nextjs/app/api/requests/[id]/signature   Pi posts (r,s). low-s normalise, isValidTransfer eth_call, then relay
app/packages/nextjs/app/api/state                one poll for the UI
app/packages/nextjs/services/chip/chain.ts       viem clients, relay account, artifact lookup (deployedContracts)
app/packages/nextjs/services/chip/relay.ts       setSigner, executeTransfer (simulate first), reads
app/packages/nextjs/services/chip/store.ts       JSON file .chip/store-<chainId>-<vault>.json, in-flight rows + device + commands
app/packages/nextjs/services/chip/keystore.ts    decrypts a foundry keystore (node scrypt + aes-128-ctr), no deps
app/packages/nextjs/scaffold.config.ts           NEXT_PUBLIC_TARGET_NETWORK=mainnet -> chains.mainnet else chains.foundry

pi/signer.py        the daemon. AteccSigner (cryptoauthlib) / SoftSigner (--mock). run: announce, commands, sign. pubkey/sign one-shots
pi/start.sh         background it with a pid file
pi/provision.py     CLI fallback for lock-config + genkey
pi/README.md        THE fresh-chip guide, with real outputs from chip #1
README.md           overview, mainnet run log, live-chain steps, audit table, trust model
docs/               photo + screenshots
```

## Data flow, exactly

1. Browser `POST /api/requests {to, toName, amount}`. Server: reads onchain nonce (+ in-flight count),
   deadline = now + 10 min, digest = `hashTypedData(domain{ChipAccount,1,chainId,vault}, Transfer{token,to,amount,nonce,deadline})`,
   cross-checks against `ChipAccount.hashTransfer`, stores row `pending`.
2. Pi `GET /api/requests?status=pending` every 1 s. For each: `atcab_sign(slot 0, digest)` -> (r, s),
   normalise s to low-s, `POST /api/requests/{id}/signature {r, s}`.
3. Server: normalise again, if this nonce is next call `isValidTransfer` (free), mark `signed`, then
   `simulateContract` + `writeContract executeTransfer`, wait receipt, mark `confirmed` with tx/gas/block.
   Response waits for the receipt so the Pi's log shows the hash.
4. UI polls `/api/state` every 1.5 s for in-flight rows, and `useScaffoldEventHistory(TransferExecuted)`
   for settled ones.

Setup jobs: browser `POST /api/commands {type}` -> Pi `GET /api/commands` -> runs status / genkey /
lock-config -> `POST /api/commands/{id}/result` -> re-announces via `POST /api/device`.

## Gotchas I hit (so you don't)

- **`PORT=8787` is in the harness shell env.** `yarn dev` will try that port (the harness's own). Always
  `env -u PORT yarn dev -p 3000`.
- **Foundry 1.7: `ETH_PASSWORD` is the password FILE path.** Passing the password itself makes foundry
  print it in an error message. Also the Makefile's non-localhost deploy passes no `--password`, so the
  env var is the only way.
- **cryptoauthlib python binding names:** `Status.ATCA_SUCCESS` (not top-level), no `LOCK_ZONE_*`
  constants (config=0, data=1), i2c address lives in a union `cfg.cfg.atcai2c.u.address`, 8-bit form.
  `signer.py` handles all of it. Error `0xF4` = execution error = unlocked chip or empty slot.
- **A blank ATECC608 cannot GenKey or Sign.** Config zone must be locked once (permanent). Data zone
  can stay unlocked; signing works that way (verified). Austin OK'd locking chip #1 only.
- **`pkill -f "signer.py run"` over ssh kills the ssh shell itself** (its command line matches). Use
  `start.sh`, which uses a pid file.
- **argparse:** shared flags are accepted before or after the subcommand; both `signer.py --mock run`
  and `signer.py run --mock` work.
- **Prettier reformats files on `yarn format`**, so string-replace patches written against the
  pre-format text silently miss. Grep before patching.
- **`AddressInput` from @scaffold-ui resolves ENS and replaces the value with the address.** The page
  keeps the typed name in a ref (`toName`) so "atg.eth" survives.
- **The Transfers list used to be the local JSON file** and showed localhost rows on mainnet. Fixed:
  onchain events are the record; the file only holds in-flight rows and is keyed by chain + vault.
- **No auth on the app.** Anyone who can reach port 3000 can queue a transfer and the Pi will sign it.
  That's why the signer is stopped overnight. Fix ideas below.
- **Keystore files made by older `cast` have no `address` field.** Get the address with
  `cast wallet address --account <name> --password-file <file>`.
- **Next dev prints a turbopack root warning** because of a stray `~/package-lock.json`; `next.config.ts`
  sets `turbopack.root` to silence it.

## Untested / open

- Sign with `--button` (gpiozero) on real GPIO. Code path exists, never run.
- `provision.py` end to end on hardware (the Setup page path was used instead; same calls).
- Chip #2 (blank). Same steps as `pi/README.md`; ask before locking.
- ATECC608**B** (revision `00006003`) should behave identically; only A was used.

## If Austin asks "what next"

1. Auth on `/api/requests` (a shared secret header, or require the browser wallet to sign the request)
   so only Austin can queue sends. Cheapest big win.
2. `--confirm` / `--button` as the default on the Pi for demos: physical approval per send.
3. Admin: hand `setAdmin` to a Safe or burn it before holding real money.
4. Audit items if this outgrows a demo: `signerEpoch` in the struct hash, `P256.isValidPublicKey` in
   `setSigner`, two-step admin, ETH withdrawal.
5. Second chip: repeat the fresh-chip guide, pair, send. Two chips can't both be signer at once; one
   vault = one key. A second vault is `yarn deploy` with the other key.

## Timeline (for the tweet / writeup)

- 12:53 repo created, `npx create-eth@latest -s foundry` per ethskills.com
- 13:20 contract + tests + mock signer working locally, first commit
- 13:45 Setup page, command queue
- 16:50 Pi online, chip found at 0x60, cryptoauthlib fixed
- 17:19 chip #1 config locked, key generated, paired, first chip-signed transfer on local anvil
- 17:58 mainnet deploy via `yarn deploy`, verified via `yarn verify`
- 18:36 first mainnet send: 5 USDS to atg.eth, tx `0x7a977bea…`, chip signed in 106 ms
- 18:49 second send, tx `0xae1ddc09…`
- 20:06 Transfers list switched to onchain events
- 20:10 audit #814 logged, ~125 USDS left overnight, Pi signer stopped
- 2026-09-05 09:30 Pi signer restarted; 5 USDS and 100 USDS sends (nonces 2, 3). Overnight: nothing stolen. Tweet: https://x.com/austingriffith/status/2096266891748860298

Austin wants a full article on this someday. Keep README, pi/README, HANDOFF, and docs/ current.
