# Soundproofing with Agricultural Waste Panels

A two-device classroom demonstration for the RJ International School science
exhibition. Open the site on two phones (or a phone and a laptop): one becomes a
**calibrated sound source**, the other a **sound-level meter**. Stand a panel
pressed from crop residue between them and the site measures, band by band, how
many decibels the panel removes.

Everything runs in the browser. No build step, no server-side code, no
dependencies, no network traffic once the page has loaded, and no audio ever
leaves the device.

## Pages

| File | Role |
|---|---|
| `index.html` | Landing page — what is being measured and why crop waste absorbs sound |
| `experiment.html` | Method, panel materials, apparatus, protocol, limitations |
| `source.html` | **Device 1** — tone generator and automatic octave-band sweep |
| `meter.html` | **Device 2** — live sound-level meter, tone recognition, recording |
| `results.html` | Charts, measurement table, comparison library, CSV export |

## How the two devices coordinate

They don't need to — there is no pairing, no server and no connection between
them. The source plays each octave-band tone in turn; the meter runs an
8192-point FFT, identifies which of the six test frequencies it is hearing, waits
for the tone to settle, averages the steady portion and files the result under
the right band automatically. That keeps the demo working on a school Wi-Fi
network, on mobile data, or on no network at all.

The meter measures each band twice — once with nothing between the devices
(*baseline*) and once with the panel in place — and reports the difference:

```
insertion loss (dB) = level without panel − level with panel
```

Because that is a difference between two readings from the same microphone, it
stays valid even on an uncalibrated phone. The calibration field only affects the
absolute dB SPL figures.

### Measurement chain, in order

1. **Overall level** — RMS of the time-domain signal from a wide analyser,
   converted to dBFS and offset into dB SPL.
2. **Tone identification** — strongest FFT peak (parabolic interpolation),
   accepted only if it stands ≥ 12 dB above the average bin and lands within 9 %
   of a test frequency.
3. **Band level** — the signal is passed through a band-pass biquad (Q = 4)
   centred on the detected tone before the RMS is taken, so room noise outside
   the band stops contaminating the reading.
4. **Noise floor** — *Measure ambient* sweeps the same filter across all six
   bands in silence. Any reading less than 10 dB above its band's floor is
   flagged in the table and excluded from the mean.

The meter requests `echoCancellation`, `noiseSuppression` and `autoGainControl`
all **off** — every one of them would flatten the difference being measured.

## Running it

The microphone requires a secure origin. Any of these work:

```bash
# local testing
python3 -m http.server 8000        # then open http://localhost:8000

# publishing (recommended for the exhibition)
# GitHub Pages: Settings → Pages → deploy from branch, root folder
```

Opening the files directly from disk (`file://`) shows every page, but the
browser will refuse to release the microphone, so the meter cannot start. The
page detects this and says so.

Chrome or Firefox on Android are the most reliable. iOS Safari works but is
stricter about honouring the audio-processing constraints.

## Data

Readings live in the browser's `localStorage` under `rjmun.*` keys — the current
session, a saved-sample library, and the source's last-used settings. Nothing is
uploaded. *Start a new sample* clears the session; the comparison library
persists until entries are removed.

CSV export includes the sample metadata, per-band levels, ambient floor,
insertion loss and the noise-floor flags.

## Re-skinning

The design follows the school site at rjschool.org: royal blue (`--brand-blue`
#1565c0), a green accent taken from the logo leaf (`--brand-green` #00963f),
light grey surfaces, and the wordmark in bold italic. All of it lives as CSS
custom properties at the top of `assets/css/site.css`, so changing those tokens
re-skins every page.

The logo is inline SVG — concentric arcs plus the green leaf — appearing twice
per page (masthead and footer). To use the school's own artwork, replace the
`<svg class="logo-mark">` blocks; the surrounding markup and sizing stay as they
are. The wordmark is set in a system sans rather than a webfont so the pages
carry no external dependency; swap `--font-display` for the school's face if you
want an exact match.

The chart palette (`--series-1`, `--series-2`, `--series-3`) is a
colourblind-safe set validated against a white chart surface: worst adjacent pair
ΔE 24.7 under protanopia, 33.6 for normal vision, all slots ≥ 3:1 contrast. If
you swap those hues, re-check them rather than picking by eye.

## Verified behaviour

The measurement chain was tested end to end by feeding synthetic sweeps into a
fake microphone device:

- All six bands auto-detected and recorded, unattended.
- Absolute level accurate to 0.3 dB against the injected signal.
- Insertion loss recovered from a known attenuation
  (3 / 6 / 10 / 14 / 19 / 24 dB) as 2.9 / 6.0 / 10.0 / 14.0 / 19.0 / 24.0 dB.

## Caveats worth repeating to a judge

This is a demonstration rig, not an acoustics laboratory. Sound travels around
the panel and through the table, so the figure is the insertion loss of the whole
arrangement rather than of the material alone. Phone speakers produce very little
energy at 125 Hz — a small Bluetooth speaker as the source makes the low bands far
more trustworthy, and the site drives it identically.
