# Drone ELRS Binding

## Methods (fastest to slowest)

### MSP (USB, no CLI)
```python
# MSP_SET_RX_BIND = 250 (triggers bind on RX)
serial.write(bytes([0x24, 0x4D, 0x3C, 0, 250, 250]))

# MSPv2 ELRS bind = 4218
# See /bind skill for full MSPv2 framing
```

### CLI (SPI RX only)
```
set expresslrs_uid = 212,139,222,54,81,10
set expresslrs_domain = FCC915
save
```
Does NOT work for external UART receivers.

### WiFi (after 60s timeout)
```
Connect to "ExpressLRS RX" / "expresslrs"
curl -X POST http://10.0.0.1/options.json -d '{"uid":[212,139,222,54,81,10]}'
```

### Serialpassthrough (kills USB)
```
serialpassthrough <uart_idx> 420000
```
Then send CRSF bind frame. FC needs power cycle after.

## RX Type Detection
- `get expresslrs` returns values → SPI RX → bind via CLI
- `get expresslrs` returns empty → UART RX → bind via MSP/WiFi

## Serial Function Codes
64 = RX_SERIAL, 1024 = CRSF_TELEMETRY, 2048 = VTX_SMARTAUDIO, 8192 = TBS_SMARTAUDIO

## Verified Drones
| Drone | Board | RX Type | ARM Channel | Failsafe |
|-------|-------|---------|-------------|----------|
| Piranha | PIRANHA_F722PRO | UART CRSF | AUX1(CH5) | DROP 20s |
| Shrike | FURYF4OSD | UART CRSF | AUX5(CH9) | AUTO-LAND 10s |
| SpeedyBee | SPEEDYBEEF405V4 | UART CRSF | AUX1(CH5) | DROP 1.5s |
