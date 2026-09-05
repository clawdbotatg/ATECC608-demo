# ATECC608-demo

Agent orientation lives in **HANDOFF.md** (state of the world, machines, secrets locations, how to run,
gotchas). Read it before touching anything. The fresh-chip hardware guide is `pi/README.md`. The
Scaffold-ETH app has its own `app/AGENTS.md`.

Hard rules:
- Never write the Pi's account password anywhere. Never commit `.env`, `.env.local`, keystores.
- Chip #2 is blank. Do not lock it without Austin saying so.
- The vault holds real USDS on mainnet. Read before you write.
