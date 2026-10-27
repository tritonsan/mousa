// The scripted player for the Thistledown comparison's clips (scripts/record-clips.mjs). Each scene runs in the page:
// `setup` stages the moment, as the arms' own capture views and play-tests stage theirs, and is not recorded; `play`
// presses the game's own keys in real time and resolves when the scene is over. Nothing in either game is changed.
// The positions come from each arm's code: the Qloo arm's pen, neighbours and Mo, the guess arm's plots and pond.
export default {
  viewport: { width: 1280, height: 800 },
  arms: {
    'with-qloo': {
      poster: { scene: 1, at: 0.8 },
      scenes: [
        {
          name: 'herding puffs into the pen', seconds: 3.6,
          setup: async () => {
            const clip = window.__clip;
            if (window.thistledown.state.mode === 'title') { clip.press('Enter'); await clip.sleep(300); }
            const S = window.thistledown.state;
            S.player.x = 74; S.player.y = 78;
            [[62, 100], [80, 94], [104, 104], [150, 118], [176, 150]].forEach(([x, y], i) => Object.assign(S.puffs[i], { x, y, vx: 0, vy: 0, penned: false }));
          },
          play: async () => {
            const clip = window.__clip, PEN = { y: 120, gateL: 50, gateR: 82 }, gx = (PEN.gateL + PEN.gateR) / 2;
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
            const end = performance.now() + 3500;
            let last = null, still = 0;
            while (performance.now() < end) {
              const S = window.thistledown.state, P = S.player;
              const free = S.puffs.filter(puff => !puff.penned).sort((a, b) => Math.hypot(a.x - P.x, a.y - P.y) - Math.hypot(b.x - P.x, b.y - P.y));
              if (!free.length) break;
              // Walk behind the nearest puff, on the far side from the gap in the fence, as the arm's play-test does.
              const p = free[0], inGap = p.y < PEN.y + 4 && Math.abs(p.x - gx) < 12;
              let dx = gx - p.x, dy = (inGap ? PEN.y + 30 : PEN.y - 14) - p.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
              const goalX = p.x - dx * 18, goalY = p.y - dy * 18;
              const round = Math.hypot(goalX - P.x, goalY - P.y) > 12 && Math.hypot(p.x - P.x, p.y - P.y) < 20;
              const tx = round ? goalX + dy * 22 : goalX, ty = round ? goalY - dx * 22 : goalY;
              const want = new Set();
              if (tx < P.x - 2) want.add('ArrowLeft'); if (tx > P.x + 2) want.add('ArrowRight');
              if (ty < P.y - 2) want.add('ArrowUp'); if (ty > P.y + 2) want.add('ArrowDown');
              still = last && Math.hypot(P.x - last.x, P.y - last.y) < 0.2 && want.size ? still + 1 : 0;
              last = { x: P.x, y: P.y };
              if (still > 12) { want.clear(); want.add(Math.abs(tx - P.x) > Math.abs(ty - P.y) ? 'ArrowUp' : 'ArrowRight'); }
              for (const key of keys) if (want.has(key)) clip.down(key); else clip.up(key);
              await clip.frame();
            }
            for (const key of keys) clip.up(key);
          },
        },
        {
          name: 'a tape-recorded interview', seconds: 3.6,
          setup: async () => {
            const S = window.thistledown.state;
            S.player.x = 126; S.player.y = 96; S.player.dir = 1; S.player.moving = false;
            await window.__clip.sleep(150);
          },
          play: async () => {
            const clip = window.__clip;
            clip.press('KeyE'); await clip.sleep(1100);
            clip.press('KeyE'); await clip.sleep(500);
            clip.press('ArrowDown'); await clip.sleep(450);
            clip.press('KeyE'); await clip.sleep(1400);
          },
        },
        {
          name: 'the band rehearsal', seconds: 3.6,
          setup: async () => {
            const clip = window.__clip;
            if (window.thistledown.state.mode === 'talk') { for (let i = 0; i < 4 && window.thistledown.state.mode === 'talk'; i++) { clip.press('KeyE'); await clip.sleep(120); } }
            const S = window.thistledown.state;
            S.player.x = 98; S.player.y = 70; S.player.dir = 1;
            for (let i = 0; i < 6 && window.thistledown.state.mode !== 'rehearse'; i++) { clip.press('KeyE'); await clip.sleep(160); }
          },
          play: async () => {
            const clip = window.__clip, codes = ['KeyJ', 'KeyK', 'KeyL'];
            const end = performance.now() + 3500;
            while (performance.now() < end) {
              const S = window.thistledown.state;
              if (S.mode !== 'rehearse') break;
              const t = S.reh.frozen != null ? S.reh.frozen : (performance.now() - S.reh.start) / 1000;
              // Nearly every note on time, as the arm's play-test plays it, so the misses show too.
              for (const note of S.reh.notes) if (!note.done && Math.abs(note.t - t) < 0.03 && (note.t * 7 | 0) % 9 !== 0) clip.press(codes[note.l]);
              await clip.frame();
            }
          },
        },
      ],
    },
    'without-qloo': {
      poster: { scene: 0, at: 0.6 },
      scenes: [
        {
          name: 'tilling, planting and watering', seconds: 3.6,
          setup: async () => { window.thistledown.applyView('day'); await window.__clip.sleep(200); },
          play: async () => {
            const clip = window.__clip;
            const act = async () => { clip.press('Space'); await clip.sleep(420); };
            await clip.sleep(200);
            await act(); await act(); await act();
            // One tile to the right, then the next plot.
            const S = window.thistledown.state(), goal = S.player.x + 16;
            clip.down('ArrowRight');
            for (let i = 0; i < 90 && window.thistledown.state().player.x < goal; i++) await clip.frame();
            clip.up('ArrowRight');
            Object.assign(window.thistledown.state().player, { dx: 0, dy: -1 });
            await clip.sleep(200);
            await act(); await act(); await act();
          },
        },
        {
          name: 'fishing with the timing bar', seconds: 3.6,
          setup: async () => { window.thistledown.applyView('fishing'); await window.__clip.sleep(150); },
          play: async () => {
            const clip = window.__clip;
            await clip.sleep(600);
            // The marker runs along the bar; the catch is a press while it is inside the green.
            const end = performance.now() + 2600;
            while (performance.now() < end) {
              const f = window.thistledown.state().fishing;
              if (!f) break;
              if (f.phase === 'bar' && f.marker > f.zone + 0.04 && f.marker < f.zone + f.width - 0.04) { clip.press('Space'); await clip.sleep(100); }
              await clip.frame();
            }
          },
        },
        {
          name: 'Lantern Night', seconds: 3.6,
          setup: async () => { window.thistledown.applyView('ending'); await window.__clip.sleep(150); },
          play: async () => { await window.__clip.sleep(3400); },
        },
      ],
    },
  },
};
