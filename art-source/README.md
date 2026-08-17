# Art sources

Originals that shipped assets are derived from. Nothing here is loaded at
runtime: `index.html` and `style.css` only reference `images/`.

## orb-v3.png → images/chord-orb.png

`orb-v3.png` is the delivered 1024x1024 orb, in the colours that replaced the
earlier green emblem. Its lit disc spans about 675px, centred near (520, 458)
rather than in the middle of the canvas, with the rest of the square being glow
falloff.

The shipped sprite is that disc cropped to a 700px square and scaled to 300x300,
2x for retina against the 150px `--orb-size` render size:

```sh
ffmpeg -i art-source/orb-v3.png \
  -vf "crop=700:700:170:108,scale=300:300:flags=lanczos" \
  -pix_fmt rgba images/chord-orb.png
```

The crop being tight to the disc is not cosmetic. `.chordCircle` lays its three
lines of text out across the full element box, so when the sprite carries a wide
margin (as the raw drop does), `background-size: cover` shrinks the visible disc
inside that box and the note line ends up drawn on bare play area either side of
the orb. Cropping tight also takes the file from 1.3MB to under 200KB.

The emblem's outer glow halo is dropped on purpose and recreated in CSS instead
(`filter: drop-shadow(...)` on `.chordCircle`), which stays crisp at any size and
can be animated.

## emblem.png

The earlier 1024x1024 green chord emblem (v2b asset drop, see
[issue #43](https://github.com/Men-in-Black-5/ideas/issues/43)), kept for
reference. It is a transparent RGBA PNG; image viewers that flatten alpha make
it look like it has a grey backdrop, but the corners are alpha 0. Its disc sits
at centre (513, 497) with a diameter of about 546px.
