# Chord Nebula

**Chord Nebula** is a web-based application designed to help you learn and practice piano chords, common progressions, harmony rules, and inversions using a MIDI keyboard. Whether you're a beginner looking to build a strong foundation or an intermediate player aiming to refine your skills, Chord Nebula offers an interactive and engaging platform to enhance your musical journey.


## Online Demo

https://chords.yottanami.com


## Features

- **Interactive Learning:** Practice chords with real-time feedback using your MIDI keyboard.
- **Progressions by genre:** Pop, rock, jazz, blues, classical, folk/country, funk/R&B and EDM, each with the progressions that genre actually runs on.
- **Seven scales:** Major and minor, plus dorian, phrygian, lydian, mixolydian and locrian, in every key. Each genre offers only the scales its harmony lives in.
- **Harmony Rules:** Learn fundamental harmony principles to improve your songwriting and improvisation skills.
- **Inversions:** Discover and practice chord inversions to add variety and complexity to your playing.
- **A ramp that follows you:** Note names are shown while you find your feet, then drop away, and the pace steps up as your score climbs.
- **Gamified Experience:** Engage in "Start Game" mode to challenge yourself and make learning fun.

## Understanding Harmony and Inversions
*Chord Nebula* not only helps you practice chords but also deepens your understanding of music theory:

*Common Progressions:* Learn the most widely used chord progressions in various musical genres. Understanding these progressions will help you create more compelling and cohesive music.

*Harmony Rules:* Gain insights into the foundational rules of harmony, enabling you to build more sophisticated and harmonically rich compositions.

*Chord Inversions:* Explore different chord inversions to add texture and complexity to your playing. Inversions allow you to play the same chord in different positions, creating smoother transitions between chords.

## Getting Started

### Prerequisites

- A MIDI keyboard connected to your computer.
- A browser with Web MIDI: Chrome, Edge, Opera or Brave. Firefox needs its
  Web MIDI site-permission add-on, and Safari has no Web MIDI support. The
  game says so on the setup screen rather than leaving you with an empty
  device list.

### Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/yourusername/chord-nebula.git
   ```
   
2. **Navigate to the Project Directory:**

	```bash
	cd chord-nebula
	```
3. **Open the Application:**
- Open the index.html file in your preferred web browser.

## How to Use

- *Open* index.html: Launch the application by opening the index.html file in your browser.
- *Choose Your MIDI Device:* Select your connected MIDI keyboard from the available devices.
- *Pick genre, scale and key:* The genre decides which progressions you get and
  which scales they can be drawn from; the scale decides which keys are offered.
  The setup screen previews the progressions the pair will deal out.
- *Pick a level:* From single scale notes up to mixed classical harmony.
- *Start the Game:* Click the "Start Game" button to begin practicing.
- *Play the Chords:* Play the prompted chords on your MIDI keyboard.

## Development

```bash
npm install     # installs typescript + vitest (dev-only; the deployed app has no runtime dependencies)
npm test        # runs the test suite (Vitest)
npm run build   # compiles src/app.ts -> dist/app.js, same as always
```

There's no bundler and `dist/app.js` is committed straight to the repo and
served as-is by GitHub Pages (`index.html` loads it via a plain
`<script>` tag, not a module). `npm run build` just formalizes the `tsc`
compile step that already existed. Tests live in `test/` and exercise the
real chord/game logic in `src/app.ts` directly (see
`test/support/loadApp.ts` for how, given `src/app.ts` isn't itself a
module with anything to import).

## Levels & unlocking

Levels 1-3 (single notes, basic triads) are free. Levels 4-8 need a
one-time purchase, verified through a small Cloudflare Worker, the one
piece of server-side infrastructure this otherwise-static site needs,
since a pure GitHub Pages site can't itself verify a purchase or gate
content. See [`worker/README.md`](worker/README.md) for the full design
rationale (Gumroad + a self-verifying signed token, not "call home on
every page load") and deployment steps.

## Contributing
I welcome contributions from developers and music enthusiasts! If you're interested in enhancing Chord Nebula, here's how you can get involved:

*Fork the Repository:* Click the "Fork" button on the GitHub repository to create your own copy.

Create a New Branch: Develop your feature or fix in a new branch.

```bash
git checkout -b feature/your-feature-name
```

*Commit Your Changes:*

```bash
git commit -m "Add your message here"
```

*Push to Your Fork:*

```bash
git push origin feature/your-feature-name
```
*Submit a Pull Request:* Navigate to the original repository and submit a pull request with a detailed description of your changes.


## License
*Chord Nebula* is licensed under the GPLv3 License. You are free to use, modify, and distribute this software in accordance with the terms of the license.

## Reporting Bugs
Encountered a bug or have a suggestion for improvement? I'd love to hear from you!
