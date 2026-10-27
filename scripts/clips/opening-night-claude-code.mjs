// The scripted player for the Opening Night comparison's clips (scripts/record-clips.mjs). Each scene runs in the page:
// `setup` stages the moment, as the arms' own capture views and self-tests stage theirs, and is not recorded; `play`
// presses the game's own keys in real time and resolves when the scene is over. Nothing in either game is changed.
// The bots are the arms' own self-test bots: the Qloo arm lands each joke on its beat, works the coldest section and
// answers a heckler with the reply that beats its kind; the guess arm swings at the pitch, picks the best comeback and
// haggles to the investor's floor.
export default {
  viewport: { width: 1280, height: 800 },
  arms: {
    'with-qloo': {
      poster: { scene: 0, at: 0.7 },
      scenes: [
        {
          name: 'landing each joke on its beat', seconds: 4,
          setup: async () => {
            const clip = window.__clip, game = window.__openingNight;
            if (game.G.scene === 'title') { clip.press('Enter'); await clip.sleep(600); }
            if (game.G.scene === 'slate') { clip.press('Space'); await clip.sleep(200); }
            // The first joke's sweep starts as the scene does.
            for (let i = 0; i < 120 && game.S.phase !== 'setup'; i++) await clip.frame();
          },
          play: async () => {
            const clip = window.__clip, game = window.__openingNight;
            const end = performance.now() + 3900;
            let nextAim = 0;
            while (performance.now() < end) {
              const S = game.S;
              const cold = S.sections.reduce((m, s, i) => (s.heat < S.sections[m].heat ? i : m), 0);
              if (S.t > nextAim && cold !== S.aim) { clip.press(cold < S.aim ? 'ArrowLeft' : 'ArrowRight'); nextAim = S.t + 1; }
              if (S.phase === 'setup' && S.pos >= S.center - 0.004) clip.press('Space');
              await clip.frame();
            }
          },
        },
        {
          name: 'answering a heckler', seconds: 4,
          setup: async () => {
            const S = window.__openingNight.S;
            // A clever heckle from the arm's own list, on the left section, as its review view stages one.
            S.heckle = { sec: 0, kind: 'clever', text: 'Is this the warm-up for the warm-up?', t: 0, limit: 3.6, result: null, rt: 0 };
            S.aim = 0;
            await window.__clip.sleep(60);
          },
          play: async () => {
            const clip = window.__clip;
            await clip.sleep(1300);
            clip.press('Digit3'); // GO SHARP beats a clever heckle.
            await clip.sleep(2600);
          },
        },
        {
          name: 'breathing back from a bomb', seconds: 4,
          setup: async () => {
            const clip = window.__clip, game = window.__openingNight;
            for (let i = 0; i < 120 && game.S.heckle; i++) await clip.frame();
            // The crowd has gone cold and composure is spent: the comeback begins.
            game.S.composure = 0;
            for (let i = 0; i < 60 && game.G.scene !== 'breath-hold'; i++) await clip.frame();
          },
          play: async () => {
            const clip = window.__clip, game = window.__openingNight;
            const end = performance.now() + 3900;
            let holding = false;
            while (performance.now() < end && game.G.scene === 'breath-hold') {
              const B = game.B, want = B.y < B.band - 0.03 || (B.y < B.band + 0.03 && B.v < 0);
              if (want && !holding) { clip.down('Space'); holding = true; }
              if (!want && holding) { clip.up('Space'); holding = false; }
              await clip.frame();
            }
            if (holding) clip.up('Space');
          },
        },
      ],
    },
    'without-qloo': {
      poster: { scene: 0, at: 0.6 },
      scenes: [
        {
          name: 'the at-bat', seconds: 4,
          setup: async () => {
            const clip = window.__clip, G = window.__openingNight;
            if (G.scene === 'title') { clip.press('Enter'); await clip.sleep(300); }
            if (G.scene === 'intro') { clip.press('Enter'); await clip.sleep(200); }
          },
          play: async () => {
            const clip = window.__clip, G = window.__openingNight;
            const end = performance.now() + 3900;
            while (performance.now() < end) {
              const p = G.segObj?.p;
              // Swing as the ball reaches the zone, high or low as the target shows; let outside pitches go.
              if (p && p.phase === 'flight' && !p.swung && p.loc !== 'OUTSIDE' && p.ft >= p.T - 0.01) {
                const lean = p.loc === 'HIGH' ? 'ArrowUp' : p.loc === 'LOW' ? 'ArrowDown' : '';
                if (lean) clip.down(lean);
                clip.press('Space');
                if (lean) clip.up(lean);
              }
              await clip.frame();
            }
          },
        },
        {
          name: 'the roast', seconds: 4,
          setup: async () => {
            const clip = window.__clip, G = window.__openingNight;
            G.seg = 1; G.scene = 'intro';
            clip.press('Enter'); await clip.sleep(200);
          },
          play: async () => {
            const clip = window.__clip, G = window.__openingNight;
            const end = performance.now() + 3900;
            while (performance.now() < end) {
              const s = G.segObj;
              if (s?.state === 'heckle' && s.t > 0.5) clip.press(`Digit${s.opts.findIndex(o => o.q === 3) + 1}`);
              else if (s?.state === 'beat' && s.m >= s.c) clip.press('Space');
              await clip.frame();
            }
          },
        },
        {
          name: 'the pitch room', seconds: 4,
          setup: async () => {
            const clip = window.__clip, G = window.__openingNight;
            G.seg = 2; G.scene = 'intro';
            clip.press('Enter'); await clip.sleep(200);
          },
          play: async () => {
            const clip = window.__clip, G = window.__openingNight;
            const end = performance.now() + 3900;
            while (performance.now() < end) {
              const s = G.segObj;
              // Talk the counter-offer to the investor's floor one step at a time, then shake on it.
              if (s?.state === 'talk' && s.t > 0.8 && s.inv) {
                if (s.counter > s.inv.floor) clip.press('ArrowDown');
                else if (s.counter < s.inv.floor && s.counter < s.inv.offer) clip.press('ArrowUp');
                else clip.press('Space');
                await clip.sleep(140);
              }
              await clip.frame();
            }
          },
        },
      ],
    },
  },
};
