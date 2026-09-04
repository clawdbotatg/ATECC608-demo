# pi/ — the signer

Runs on the Raspberry Pi with the ATECC608 on I2C. The chip holds the P-256 key that owns the
vault contract. Nothing here touches the chain: the Pi signs 32-byte digests and talks HTTP to the app.

```
app (Mac)  --request {to, amount, digest}-->  Pi  --{r, s}-->  app relay  --tx-->  ChipAccount.executeTransfer
```

## Try it without the chip

```bash
pip3 install -r requirements.txt        # cryptoauthlib may fail on a Mac, that's fine for --mock
python3 signer.py run --mock --app http://localhost:3000
```

`--mock` uses a software P-256 key stored in `.mock_key.pem` (gitignored). Same code path, same
low-s normalisation, same HTTP calls. The Foundry tests also call this script.

## Wiring (ATECC608A/B breakout, I2C)

| Breakout | Pi header          |
|----------|--------------------|
| VIN/VCC  | 3V3 (pin 1)        |
| GND      | GND (pin 6)        |
| SDA      | GPIO2 / SDA (pin 3)|
| SCL      | GPIO3 / SCL (pin 5)|

```bash
sudo raspi-config            # Interface Options -> I2C -> enable, then reboot
sudo apt install -y i2c-tools python3-pip cmake build-essential
i2cdetect -y 1               # expect 60 (Adafruit/SparkFun) or 35 (TrustFLEX / Trust&Go)
```

The chip sleeps between commands and may not show in `i2cdetect` every time. Run it twice.

## Install cryptoauthlib on the Pi

```bash
pip3 install --break-system-packages cryptoauthlib requests cryptography
python3 -c "import cryptoauthlib as c; c.load_cryptoauthlib(); print('ok')"
```

If the wheel has no `libcryptoauth.so` for your Pi, build it:

```bash
git clone https://github.com/MicrochipTech/cryptoauthlib && cd cryptoauthlib
cmake -B build -DATCA_HAL_I2C=ON -DATCA_ATECC608_SUPPORT=ON -DATCA_BUILD_SHARED_LIBS=ON
cmake --build build -j4 && sudo cmake --install build && sudo ldconfig
```

## Provision (skip for TrustFLEX / Trust&Go parts, they ship locked)

Breakouts ship unlocked with no key. Use the app's **/setup** page: start `signer.py run` first, then
click Lock config → Generate key → Pair. Config lock is permanent and required by the chip. The data
zone stays unlocked so Generate key can be re-run.

CLI fallback:

```bash
python3 provision.py --i2c-addr 0x60          # dry run
python3 provision.py --i2c-addr 0x60 --yes    # write config, lock config, GenKey slot 0
```

## Run

```bash
python3 signer.py pubkey --i2c-addr 0x60                              # sanity check
python3 signer.py run --app http://<mac-ip>:3000 --i2c-addr 0x60      # sign everything that arrives
python3 signer.py run --app http://<mac-ip>:3000 --confirm            # ask on the terminal first
python3 signer.py run --app http://<mac-ip>:3000 --button 17          # wait for a button on GPIO17
```

On start it POSTs its public key and chip status to `/api/device`, then polls `/api/commands` for
setup jobs and `/api/requests` for transfers to sign. Pairing is the Pair button on /setup (the relay
calls `setSigner`; on localhost the relay is the contract admin). On a live chain either the deployer
runs the Pair button with `RELAYER_PRIVATE_KEY` set to its key, or you put `CHIP_PUBKEY_X/Y` in
`app/packages/foundry/.env` before `yarn deploy`.

## Notes

- The ATECC608 signs a raw 32-byte digest. It does not hash. The app sends the finished EIP-712 digest.
- ECDSA has two valid `s` values. The contract (OpenZeppelin `P256`) accepts only the low one, so the
  signer normalises `s > n/2` to `n - s` before posting. The relay does it again, defensively.
- A request expires 10 minutes after it is created. Sign it or it is dropped.
- `--i2c-addr` is the 7-bit address. cryptoauthlib wants it shifted; the script does that.
