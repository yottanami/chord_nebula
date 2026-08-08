# Art sources

Originals that shipped assets are derived from. Nothing here is loaded at
runtime — `index.html` and `style.css` only reference `images/`.

## emblem.png → images/chord-orb.png

`emblem.png` is the delivered 1024x1024 chord emblem (v2b asset drop, see
[issue #43](https://github.com/Men-in-Black-5/ideas/issues/43)). It is already
a transparent RGBA PNG; image viewers that flatten alpha make it look like it
has a grey backdrop, but the corners are alpha 0.

The glowing disc inside it sits at centre (513, 497) with a diameter of ~546px.
The shipped sprite is that disc cropped to a 552px square and scaled to 220x220
— 2x for retina, against the 110px `.chordCircle` render size:

```sh
ffmpeg -i art-source/emblem.png \
  -vf "crop=552:552:237:221,scale=220:220:flags=lanczos" \
  -pix_fmt rgba images/chord-orb.png
```

The crop is deliberately tight to the disc so it fills the sprite box
edge-to-edge and lines up with `border-radius: 50%`. The emblem's outer glow
halo is dropped on purpose and recreated in CSS instead (`filter:
drop-shadow(...)` on `.chordCircle`), which stays crisp at any size and can be
animated.
