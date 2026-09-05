# HANDOFF — read this first if you are the next agent (or future me)

Last updated 2026-09-05 11:30, after the demo was retired. No secrets in this file. Secrets live only
in gitignored files on Austin's Mac; their *locations* are listed below.

## What this is, in one paragraph

A Raspberry Pi with an ATECC608A secure element holds a P-256 key. That key owned a vault contract
(`ChipAccount`) on Ethereum mainnet holding real USDS. A Next.js app (Scaffold-ETH 2) let Austin type
"5 USDS to atg.eth"; the app built an EIP-712 digest, the Pi polled it, the chip signed it, the Pi
posted the signature back, the app's relay paid gas and called `executeTransfer`, the contract verified
the P-256 signature (EIP-7951 precompile) and moved the tokens. Six chip-signed mainnet sends happened
over two days. The private key has never existed outside the chip. Austin tweeted it and wants a full
article later, so every doc here must stay accurate.

## State of the world (2026-09-05, retired)

| Thing | State | Where |
|---|---|---|
| Vault contract | live, verified, **0 USDS**, nonce 6. Retired but intact. | mainnet `0x0336aD6afc8bE414D6BD1f7A16caEb14BCCd16e9` |
| Token used | real USDS, 18 decimals | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` |
| Relay / deployer / contract admin | one EOA, swept; ~0.000008 ETH left (can't send a tx) | `0x7FE7f508A267BF45D2D161F244DbB12743e2cf49`, foundry keystore `atecc-relay` |
| Chip #1 | ATECC608A, config LOCKED, data unlocked, P-256 key in slot 0, still paired to the vault | on the Pi, I2C 0x60, serial `01235e6763cc8d97ee` |
| Chip #2 | blank, unlocked. **Do not lock without asking Austin.** | Austin has it |
| Pi | Austin took it back for other work. Signer **stopped**. Repo clone still at `~/ATECC608-demo`. Ask before touching. | on Austin's LAN |
| Next.js app | may still be running on Austin's Mac in mainnet mode; harmless with the signer off | http://localhost:3000 |
| anvil | may still be running from local testing; harmless | port 8545 on the Mac |
| Repo | public, all pushed, tree clean | github.com/clawdbotatg/ATECC608-demo |
| Audit | onedollaraudit #814, no outside-theft path; findings + responses tabled in README | README "Audit" |
| Tweet | https://x.com/austingriffith/status/2096266891748860298 | |

### Every mainnet transaction

| What | Tx |
|---|---|
| Deploy ChipAccount (chip key baked in) | `0xa5d10ea42dfff94a6437ace48cc1440b21749dbe37e171863e8a79347369c805` |
| Austin: 10 USDS in | `0xb85ad3fff1585504f6866d538abb0653b7e7293c4de7a9e2871d9b5a1a94bf88` |
| chip: 5 USDS → atg.eth (nonce 0) | `0x7a977bea22e648d4173fc76cdfce2242ede6ff525b3c15590ef109561aa94b9a` |
| chip: 5 USDS (nonce 1) | `0xae1ddc09c701ef1bfa2d50ef818e07516a8979bdc312c9f5f6ad4e990fd84ddc` |
| Austin: more USDS in (total ~125 overnight) | see token transfers on Etherscan |
| chip: 5 USDS (nonce 2) | `0x977480563b6c2b0c65385fed36885cafeb24eb5ee4028b3eb7bc97f0649fa791` |
| chip: 100 USDS (nonce 3), the tweet | `0xfa6d5a8624f29287c35708fc0f2265cc948f06acd4e1156ead6747a405d81610` |
| chip: 19.558 USDS (nonce 4) | `0x223e2a6ec14b8de2db4e16705cc05e4c15f52f1df21ed71e251f9e1bba577f7f` |
| chip: 0.000985 USDS dust (nonce 5) | `0x7d26087a4b5508a1e3c929d30fbdfbd887f1805d82bf0bc4dfd1360c0a725728` |
| relay ETH sweep, failed (21000 gas, atg.eth is 7702) | `0x7f1738361af21f796cf09a81d2f2626ebed58c388190a2b91c958ce769339954` |
| relay ETH sweep, success | `0xa7b2a22fa0fe61087152e3db9869a220dec7e6b5630501c83d5401934ac9952a` |

Every chip send: ~81.7k gas, chip signs in ~100 ms, 1 to 2 s from click to signature.

## Machines and access

- **Mac** (this box): repo at `~/clawd/clawd-harness/projects/ATECC608-demo`. LAN IP:
  `ipconfig getifaddr en0`.
- **Pi**: `ssh <pi-user>@<pi-ip>` (values are in agent memory, not here). Key login works from the Mac.
  There is an account password; it is NOT written anywhere and must never be. `sudo` needs it, so
  avoid sudo. `pip3 install --user --break-system-packages` works without it. No i2c-tools installed.
- Repo clone on the Pi: `~/ATECC608-demo`. `git pull` there after pushing.

## Secrets: what exists and where (never commit, never print)

| Secret | Location | Notes |
|---|---|---|
| Relay private key | `~/.foundry/keystores/atecc-relay` (encrypted v3 keystore) | never decrypted to a file. Empty of ETH now. |
| Its password | `~/.foundry/keystores/atecc-relay.password.txt` | rotated once after a foundry error echoed it into a session log |
| App env (mainnet switch, keystore name, password *file path*, USDS address) | `app/packages/nextjs/.env.local` | gitignored |
| Foundry env (Alchemy + Etherscan keys = SE2 shared defaults, `USDS_ADDRESS`, `CHIP_PUBKEY_X/Y`) | `app/packages/foundry/.env` | gitignored |
| Mock signer software key | `pi/.mock_key.pem` | gitignored, only for `--mock` |
| App runtime queue | `app/packages/nextjs/.chip/store-<chainId>-<vault>.json` | gitignored, not secret, just state |
| Pi account password | Austin's head | not ours to store |

A global gitleaks pre-commit hook runs on every commit in every repo on this Mac. On 2026-09-04 I
added exact-literal allowlist entries to `~/.config/gitleaks/gitleaks.toml` for Scaffold-ETH template
values (anvil dev key #9 on the `ethereum-private-key-cli` rule with `regexTarget = "match"`, SE2's
shared Alchemy key, two token addresses, the vendored yarn `.cjs` for the bip39 rule). Backup at
`gitleaks.toml.bak-2026-09-04`. If a commit is blocked, read the finding; never `--no-verify`.

The full git history was scanned before the tweet: no keys, passwords, env files, or keystores were
ever committed. LAN IP and Pi username were in an early HANDOFF commit and later replaced with
placeholders (not secrets, just tidiness).

## How to bring it back

The contract and the chip pairing are intact. To send again:

```bash
# 0. ask Austin for the Pi, and confirm chip #1 is still plugged in
# 1. fund the relay: send ~0.003 ETH to 0x7FE7f508A267BF45D2D161F244DbB12743e2cf49
# 2. send USDS to the vault 0x0336aD6afc8bE414D6BD1f7A16caEb14BCCd16e9
# 3. app on the Mac (check first: curl -s localhost:3000/api/state)
cd ~/clawd/clawd-harness/projects/ATECC608-demo/app/packages/nextjs
env -u PORT yarn dev -p 3000              # harness shell exports PORT=8787, must override
# 4. signer on the Pi
ssh <pi-user>@<pi-ip> '~/ATECC608-demo/pi/start.sh http://<mac-ip>:3000 --i2c-addr 0x60'
ssh <pi-user>@<pi-ip> 'tail -f ~/ATECC608-demo/pi/signer.log'
# 5. browser http://localhost:3000 -> recipient, amount, Send to chip
```

Add `--confirm` (terminal yes/no) or `--button 17` (GPIO) to `start.sh` for a physical approval
step. Add `--allow-lock` only when you intend to lock a chip. Stop with `kill $(cat ~/ATECC608-demo/pi/signer.pid)`
on the Pi; never `pkill -f "signer.py run"` over ssh (it kills the ssh shell, see gotchas).

To sweep the relay's ETH again: `cast send <to> --value <bal - 40000*gasprice> --gas-limit 40000
--account atecc-relay --password-file ~/.foundry/keystores/atecc-relay.password.txt --rpc-url mainnet`
from `app/packages/foundry` (the `mainnet` RPC alias is in foundry.toml).

### Localhost instead

```bash
cd app && yarn chain              # anvil
yarn deploy                       # MockUSDS + ChipAccount on 31337, 1000 USDS minted into the vault
# blank/remove NEXT_PUBLIC_TARGET_NETWORK in packages/nextjs/.env.local, then
cd packages/nextjs && env -u PORT yarn dev -p 3000
cd ../../../pi && python3 signer.py run --mock --app http://localhost:3000   # or the real Pi
```

`/setup`: lock config (mock skips) → generate key → pair → mint. On localhost the relay is anvil
account #9 via `eth_sendTransaction` (no key anywhere), which is also the deployer, so Pair works.

### Tests

```bash
cd app/packages/foundry && forge test        # 12 tests; sigs come from ../../../pi/signer.py --mock via ffi
cd app && yarn workspace @se-2/nextjs check-types && yarn workspace @se-2/nextjs lint
```

### Redeploy (new vault, any chain in foundry.toml)

```bash
cd app
ETH_PASSWORD=$HOME/.foundry/keystores/atecc-relay.password.txt yarn deploy --network mainnet --keystore atecc-relay
yarn verify --network mainnet
```

`CHIP_PUBKEY_X/Y` in `packages/foundry/.env` bake the chip key in (no Pair needed). `yarn deploy`
rewrites `packages/nextjs/contracts/deployedContracts.ts` (address + `deployedOnBlock`); commit it.
Everything in the app resolves addresses from that file. Nothing is hardcoded.

## Code map

```
app/packages/foundry/contracts/ChipAccount.sol   vault. signerX/Y, admin, nonce. executeTransfer(token,to,amount,deadline,r,s)
                                                 EIP-712 "ChipAccount" v1. OpenZeppelin P256.verify (precompile 0x100, Solidity fallback)
app/packages/foundry/contracts/MockUSDS.sol      localhost only, anyone can mint
app/packages/foundry/script/DeployChipDemo.s.sol env: CHIP_PUBKEY_X/Y, CHIP_ADMIN, USDS_ADDRESS
app/packages/foundry/test/ChipAccount.t.sol      replay, tamper, wrong key, expiry, unpaired, fuzz, known-answer vector

app/packages/nextjs/app/page.tsx                 Send page. Transfers = TransferExecuted events (useScaffoldEventHistory,
                                                 from deployedOnBlock) merged with local in-flight rows
app/packages/nextjs/app/setup/page.tsx           Setup: lock / genkey / pair / fund. Drives the Pi via the command queue
app/packages/nextjs/app/api/device               Pi announces key + chip status (POST); read (GET)
app/packages/nextjs/app/api/commands             browser queues jobs (POST), Pi polls (GET); [id]/result = Pi reports back
app/packages/nextjs/app/api/pair                 relay calls setSigner(device key)
app/packages/nextjs/app/api/fund                 localhost: mint MockUSDS into the vault
app/packages/nextjs/app/api/requests             POST: digest (viem hashTypedData, cross-checked with contract.hashTransfer), queue
                                                 GET ?status=pending: what the Pi signs
app/packages/nextjs/app/api/requests/[id]/signature   Pi posts (r,s): low-s normalise, isValidTransfer eth_call, then relay
app/packages/nextjs/app/api/state                one poll for the UI
app/packages/nextjs/services/chip/chain.ts       viem clients, relay account (keystore / raw key / anvil #9), artifact lookup
app/packages/nextjs/services/chip/relay.ts       setSigner, executeTransfer (simulate first), reads
app/packages/nextjs/services/chip/store.ts       JSON file per chain+vault: in-flight rows, device, commands
app/packages/nextjs/services/chip/keystore.ts    decrypts a foundry v3 keystore (node scrypt + aes-128-ctr), no deps
app/packages/nextjs/scaffold.config.ts           NEXT_PUBLIC_TARGET_NETWORK=mainnet → chains.mainnet, else chains.foundry

pi/signer.py        the daemon. AteccSigner (cryptoauthlib) / SoftSigner (--mock). run: announce, commands, sign. pubkey/sign one-shots
pi/start.sh         background it with a pid file (signer.pid, signer.log)
pi/provision.py     CLI fallback for lock-config + genkey
pi/README.md        THE fresh-chip guide, with real outputs from chip #1
README.md           overview, mainnet run log (every tx), live-chain steps, audit table, trust model
docs/               Pi photo + UI screenshots
```

## Data flow, exactly

1. Browser `POST /api/requests {to, toName, amount}`. Server: onchain nonce + in-flight count, deadline
   = now + 10 min, digest = `hashTypedData(domain{ChipAccount,1,chainId,vault}, Transfer{token,to,amount,nonce,deadline})`,
   cross-checked against `ChipAccount.hashTransfer`, row stored `pending`.
2. Pi `GET /api/requests?status=pending` every 1 s. For each: `atcab_sign(slot 0, digest)` → (r, s),
   normalise s to low-s, `POST /api/requests/{id}/signature {r, s}`.
3. Server: normalise again; if this nonce is next, `isValidTransfer` (free); mark `signed`;
   `simulateContract` + `writeContract executeTransfer`; wait receipt; mark `confirmed` with tx/gas/block.
   The response waits for the receipt so the Pi's log shows the hash.
4. UI polls `/api/state` every 1.5 s for in-flight rows and `useScaffoldEventHistory(TransferExecuted)`
   for settled ones. The chain is the record; the JSON file only holds what can't be onchain yet.

Setup jobs: browser `POST /api/commands {type}` → Pi `GET /api/commands` → runs status / genkey /
lock-config → `POST /api/commands/{id}/result` → re-announces via `POST /api/device`.

## Chip facts (verified on chip #1)

- A blank ATECC608 refuses GenKey and Sign with `0xF4` until the **config zone** is locked. Locking is
  permanent and normal. It does not put a key in. Microchip's reference config is in
  `AteccSigner.CONFIG`; slot 0 = P-256 private key, external sign, GenKey allowed.
- The **data zone** can stay unlocked. GenKey and Sign both work that way. GenKey can be re-run.
- Sign takes ~100 ms. Public key read is `atcab_get_pubkey(slot)`; `0xF4` there = empty slot.
- Revision `00006002` = 608A, `00006003` = 608B. Serial 9 bytes, starts `0123`, ends `EE`.
- 16 slots; with this config slots 0-7 are private keys = up to 8 independent accounts. No seed phrase.
- Curve is secp256r1 (P-256), not secp256k1. `ecrecover` can't verify it; EIP-7951 precompile at
  `0x100` can (live on mainnet since Fusaka). Same curve as passkeys / Secure Enclave.

## Gotchas I hit (so you don't)

- **`PORT=8787` is in the harness shell env.** `yarn dev` grabs it (the harness's own port). Always
  `env -u PORT yarn dev -p 3000`.
- **Foundry 1.7: `ETH_PASSWORD` is the password FILE path.** Passing the password itself makes foundry
  print it in an error. The SE2 Makefile passes no `--password` on live networks, so the env var is
  the only way.
- **cryptoauthlib python binding:** `Status.ATCA_SUCCESS` (not top-level), no `LOCK_ZONE_*` constants
  (config=0, data=1), i2c address is in a union `cfg.cfg.atcai2c.u.address`, 8-bit form. `signer.py`
  handles all of it. The PyPI wheel worked on Debian 13 aarch64 / Python 3.13 without building.
- **`pkill -f "signer.py run"` over ssh kills the ssh shell itself** (its command line matches). Use
  `start.sh` and the pid file.
- **argparse:** shared flags accepted before or after the subcommand.
- **Prettier reformats on `yarn format`**, so string-replace patches against pre-format text silently
  miss. Grep before patching; check the assertion output.
- **`AddressInput` (@scaffold-ui) resolves ENS and replaces the value with the address.** The page
  keeps the typed name in a ref so "atg.eth" survives to the card.
- **atg.eth (`0x34aA…fDF3`) is an EIP-7702 delegated account.** A plain ETH transfer needs ~21.2k gas;
  a 21000 limit reverts. ERC-20 transfers to it are fine.
- **No auth on the app.** Anyone who can reach port 3000 can queue a transfer and the Pi signs it. That
  was the actual attack surface, hence the signer was off overnight.
- **Old `cast` keystores have no `address` field.** Use `cast wallet address --account <name> --password-file <f>`.
- **Nested heredoc:** a README containing `<<'EOF'` inside an outer `<<'EOF'` heredoc truncates the
  outer one. Use a distinct delimiter.
- **The store used to be one file** and showed localhost rows on mainnet. Now keyed per chain+vault,
  and settled rows come from events anyway.

## Audit (#814) in one line each

No outside-theft path. High: token pause/blocklist could strand funds (accepted; a rescue path is an
admin backdoor). Medium: admin can `setSigner` and drain (true; admin = relay keystore; use a multisig or
burn for real money), no on-curve check in `setSigner`, cross-epoch replay of pre-signed future nonces
(app never pre-signs). Lows/infos: preview view omits checks, ETH stuck, fixed deadline, event logs
requested amount, no reentrancy guard, single-step admin, missing constructor event, no pause. All
accepted for a demo; full table in README.

## If Austin picks this up again

1. Auth on `/api/requests` (shared secret header, or browser wallet signs the request).
2. `--confirm` / `--button` as the default: physical approval per send.
3. Admin → Safe or burned before holding real money.
4. Audit items if it outgrows a demo: `signerEpoch` in the struct hash, `P256.isValidPublicKey` in
   `setSigner`, two-step admin, ETH withdrawal.
5. Chip #2: follow `pi/README.md`; ask before locking. One vault = one key; a second vault is another
   `yarn deploy` with the other key.
6. The article: README + pi/README + this file + docs/ are the source material. Keep them current.

## Timeline

- 2026-09-04 12:53 repo created, `npx create-eth@latest -s foundry` per ethskills.com
- 13:20 contract + 12 tests + mock signer working locally, first commit
- 13:45 Setup page, command queue for the Pi
- 16:50 Pi online, chip found at 0x60, cryptoauthlib API mismatches fixed
- 17:19 chip #1 config locked (Austin's OK), key generated, paired, first chip-signed transfer on anvil
- 17:58 mainnet deploy via `yarn deploy`, verified via `yarn verify`
- 18:36 first mainnet send, 5 USDS to atg.eth, chip signed in 106 ms
- 18:49 second send
- 20:06 Transfers list switched to onchain events, per-chain store
- 20:10 audit #814 logged, ~125 USDS left overnight, signer stopped
- 2026-09-05 09:30 signer restarted; 5 USDS and 100 USDS sends; tweet posted
- 10:20 Austin took the Pi back; signer stopped
- 10:40 brought back for wind-down: 19.558 USDS + dust out via the chip, relay ETH swept; retired
