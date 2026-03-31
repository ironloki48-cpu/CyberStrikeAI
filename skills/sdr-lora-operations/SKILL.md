# SDR & LoRa Operations

## HackRF Quick Reference
```bash
hackrf_info                           # Device status
hackrf_sweep -f 740:760 -1            # Spectrum sweep
hackrf_transfer -r out.raw -f FREQ -s 20000000 -l 40 -g 48 -n SAMPLES  # Capture
hackrf_transfer -t sig.raw -f FREQ -s 20000000 -x 47 -R               # Transmit repeat
```

Limits: 20MHz BW, 8-bit ADC, half-duplex (can't TX+RX simultaneously)

## IQ File Format (HackRF raw = int8 interleaved IQ)
```python
# Read
raw = np.fromfile('capture.raw', dtype=np.int8)
iq = (raw[0::2] + 1j*raw[1::2]).astype(np.complex64) / 128.0
iq -= np.mean(iq)  # DC removal

# Write
out = np.empty(len(sig)*2, dtype=np.int8)
out[0::2] = np.clip(np.real(sig)*127, -127, 127).astype(np.int8)
out[1::2] = np.clip(np.imag(sig)*127, -127, 127).astype(np.int8)
out.tofile('signal.raw')
```

## LoRa PHY Encode Chain (verified from gr-lora_sdr)
```
Payload → Whitening (LFSR XOR) → Nibble split → Hamming FEC → Diagonal interleave → Gray map → Chirp modulation
```
Key: whitening sequence from gr-lora_sdr/lib/tables.h (255 bytes, starts 0xFF,0xFE,0xFC,0xF8...)
Full encoder: `~/combat/elrs_attack/lora_encoder.py`

## ELRS LoRa Parameters (900MHz)
| Rate | SF | BW | CR | Hop Interval | Channels |
|------|----|----|----|----|---|
| 200Hz | 6 | 500kHz | 4/7 | 5ms | 40 (FCC915) |
| 100Hz | 7 | 500kHz | 4/7 | 10ms | 40 |
| 50Hz | 8 | 500kHz | 4/7 | 20ms | 40 |
| 25Hz | 9 | 500kHz | 4/7 | 40ms | 40 |

## Wideband FHSS Signal Generation
Pre-bake all hops at SDR sample rate, frequency-shift each to correct channel:
```python
for hop in range(N):
    freq_offset = ch_freqs[fhss_seq[hop]] - SDR_CENTER
    iq = lora_encode(ota_pkt, sf=7)
    shifted = iq * np.exp(1j * 2*np.pi * freq_offset * np.arange(len(iq))/SDR_FS)
    signal[hop*HOP_SAMPLES:] += shifted
```
Single hackrf_transfer call transmits entire hopping sequence.

## Frequency Bands
| Band | Range | Use | HackRF Coverage |
|------|-------|-----|-----------------|
| 740-760 MHz | Russian FPV custom | **Full** (20MHz BW) |
| FCC915 | 903.5-926.9 MHz | ELRS standard | 34/40 channels |
| EU868 | 863.3-869.6 MHz | ELRS Europe | Full |
| ISM2G4 | 2400-2480 MHz | ELRS/WiFi | 20/80 channels |

## Spectrum Analysis
```python
spec = 10*np.log10(np.abs(fftshift(fft(iq[:2**20])))**2/2**20 + 1e-10)
noise = np.median(spec)
# Signal: spec[i] - noise > 6 dB
# FHSS signature: energy spread across many channels vs single peak (continuous TX)
```

## Verified Results (2026-03-24)
- ELRS FHSS energy confirmed across all 40 channels on 740-760 MHz
- Static sync channel TX triggered ELRS module detection alert
- AI flight sequence transmitted: idle→hover→forward→turn→return→land
- LoRa preamble accepted by SX1276, payload needs exact encoding for packet acceptance
- gr-lora_sdr source used to correct whitening/FEC/interleaver

## Tools
| File | Purpose |
|------|---------|
| `~/combat/elrs_attack/elrs_sdr_capture.py` | Capture, sweep, detect |
| `~/combat/elrs_attack/elrs_jammer.py` | Barrage/predictive/sync jam |
| `~/combat/elrs_attack/drone_simulator.py` | ELRS drone sim via HackRF |
| `~/combat/elrs_attack/lora_encoder.py` | Full LoRa PHY encoder |

## Hardware Upgrade Path
- **LimeSDR** (60MHz BW, full-duplex): simultaneous jam + inject
- **KrakenSDR** (5-ch coherent): direction finding, locate pilot
- **BladeRF** (FPGA): low-latency reactive jam at 250Hz+
- **USRP B210** (56MHz BW): wideband + full-duplex
