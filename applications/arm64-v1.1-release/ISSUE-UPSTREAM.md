# GitHub Issue — copy/paste for Taj-Coin/tajcoin

**Title:** `Release v1.1 — ARM64 (aarch64) Linux builds for tajcoind and tajcoin-qt`

---

Hello,

We maintain [TajNet](https://github.com/edsongomes-ctrl/tajnet) (Tajcoin node + IPFS) and run Tajcoin on **ARM64** servers (VPS, Raspberry Pi class devices). The current [v1.1 release](https://github.com/Taj-Coin/tajcoin/releases/tag/v1.1) only ships x86_64 Linux binaries (18.04 / 20.04) and Win64 — **no ARM64 builds**.

We would like to contribute official release assets for **v1.1** (or **v1.1.1**):

| Asset | Description |
|-------|-------------|
| `tajcoind-arm64-v1.1.zip` | `tajcoind` daemon, ELF aarch64 |
| `tajcoin-qt-arm64-v1.1.zip` | Qt wallet binary, ELF aarch64 |
| `tajcoin-qt_1.1.0.0-1_arm64.deb` | Debian package (arm64), stripped, Qt5 |

**Build:** compiled from Tajcoin **v1.1** source tag.  
**Checksums (SHA256):**

```
38c654c86f0a75dbb30dd92f9e65871a226033045896d7a08163475200fc7ad1  tajcoind-arm64-v1.1.zip
749550639959c5ca2260e7d578baf1bcb26f2b87c59b089cd7404deaa8fe4697  tajcoin-qt-arm64-v1.1.zip
f5bf08f63418a8d66c68ea6e818cc65306ce4ed248fe8ac2e11f678d75774759  tajcoin-qt_1.1.0.0-1_arm64.deb
```

Built and verified on **aarch64** (Raspberry Pi, Debian). `tajcoind` stripped release binary ~3.2 MB.

Would you accept these as additional assets on the v1.1 release page?

Thanks,  
[TajNet / edsongomes-ctrl]
