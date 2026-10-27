// The scripted player for the Saltmarsh comparison's clips (scripts/record-clips.mjs). Each scene runs in the page:
// `setup` stages the moment through the game's own doors and conversations and is not recorded; `play` presses the
// game's own keys in real time and resolves when the scene is over. Nothing in either game is changed.
// The positions come from each arm's code: the Qloo arm's lighthouse, boathouse and bus-shelter doors, the guess arm's
// neighbours in the town. The guess arm's key board is its BOARD, row by row.
export default {
  viewport: { width: 1280, height: 800 },
  arms: {
    'with-qloo': {
      poster: { scene: 0, at: 0.7 },
      scenes: [
        {
          name: 'tuning the radio through the static', seconds: 4,
          setup: async () => {
            const clip = window.__clip, game = window.SALTMARSH;
            const settle = async scene => { for (let i = 0; i < 400 && (game.scene !== scene || game.transitioning); i++) await clip.frame(); };
            if (game.scene === 'title') { clip.press('Enter'); await settle('walk'); }
            Object.assign(game.state.player, { x: 110, y: 256 });
            await clip.frame();
            clip.press('Space'); // the lighthouse porch radio
            await settle('radio');
          },
          play: async () => {
            const clip = window.__clip, game = window.SALTMARSH;
            const end = performance.now() + 3900;
            let held = '', space = false;
            const steer = key => { if (held === key) return; if (held) clip.up(held); if (key) clip.down(key); held = key; };
            while (performance.now() < end && game.scene === 'radio') {
              const R = game.state.radio, target = game.radioTarget();
              if (!R || R.done) break;
              // Follow the drifting station, and hold Space to lock on once the voice is clear.
              steer(R.freq < target - 0.12 ? 'ArrowRight' : R.freq > target + 0.12 ? 'ArrowLeft' : '');
              const want = (R.signal || 0) > 0.8;
              if (want && !space) { clip.down('Space'); space = true; }
              if (!want && space) { clip.up('Space'); space = false; }
              await clip.frame();
            }
            steer(''); if (space) clip.up('Space');
          },
        },
        {
          name: 'keeping time with the band', seconds: 4,
          setup: async () => {
            const clip = window.__clip, game = window.SALTMARSH;
            const settle = async scene => { for (let i = 0; i < 400 && (game.scene !== scene || game.transitioning); i++) await clip.frame(); };
            clip.press('Escape'); await settle('walk');
            Object.assign(game.state.player, { x: 810, y: 260 });
            await clip.frame();
            clip.press('Space'); // the boathouse
            await settle('rehearsal');
            clip.press('Space'); // count in
            await clip.sleep(1500);
          },
          play: async () => {
            const clip = window.__clip, game = window.SALTMARSH, lanes = ['ArrowLeft', 'ArrowDown', 'ArrowRight'];
            const end = performance.now() + 3900;
            while (performance.now() < end && game.scene === 'rehearsal') {
              const R = game.state.reh;
              if (R.phase !== 'play') break;
              const t = game.clock - R.start;
              for (const note of R.notes) if (!note.hit && !note.miss && Math.abs(note.ms - t) < 25) clip.press(lanes[note.lane]);
              await clip.frame();
            }
          },
        },
        {
          name: 'talking Marguerite round at the bus shelter', seconds: 4,
          setup: async () => {
            const clip = window.__clip, game = window.SALTMARSH;
            const settle = async scene => { for (let i = 0; i < 400 && (game.scene !== scene || game.transitioning); i++) await clip.frame(); };
            clip.press('Escape'); await settle('walk');
            Object.assign(game.state.player, { x: 235, y: 484 });
            await clip.frame();
            clip.press('Space'); // sit down beside Marguerite
            await settle('talk');
          },
          play: async () => {
            const clip = window.__clip;
            await clip.sleep(700);
            clip.press('Digit1'); // the honest answer, as the arm's own play-test chooses
            await clip.sleep(1900);
            clip.press('Enter');
            await clip.sleep(700);
            clip.press('Digit1');
            await clip.sleep(500);
          },
        },
      ],
    },
    'without-qloo': {
      poster: { scene: 2, at: 0.5 },
      scenes: [
        {
          name: 'hanging the hotel\'s keys', seconds: 4,
          setup: async () => {
            const clip = window.__clip, G = window.saltmarsh.state;
            const until = async (test, frames = 600) => { for (let i = 0; i < frames && !test(); i++) await clip.frame(); };
            if (G.mode === 'title') { clip.press('Enter'); await until(() => window.saltmarsh.state.mode === 'town'); }
            Object.assign(window.saltmarsh.state.player, { x: 200, y: 382 });
            await clip.frame();
            // Mr. Pell asks for the favour; his lines are read through, and the favour's card plays.
            for (let i = 0; i < 40 && window.saltmarsh.state.mode !== 'keys'; i++) { if (window.saltmarsh.state.dialog || window.saltmarsh.state.mode === 'town') clip.press('KeyE'); await clip.sleep(150); }
            await until(() => window.saltmarsh.state.mode === 'keys');
            await clip.sleep(900); // the iris opens on the board; the board waits for the player
          },
          play: async () => {
            const clip = window.__clip, BOARD = [[301, 302, 303], [201, 202, 203], [101, 102, 103]];
            const end = performance.now() + 3900;
            while (performance.now() < end) {
              const m = window.saltmarsh.state.mini;
              if (window.saltmarsh.state.mode !== 'keys' || m.done) break;
              const want = m.queue[m.idx], r = BOARD.findIndex(row => row.includes(want)), c = BOARD[r].indexOf(want);
              const cr = Math.floor(m.cur / 3), cc = m.cur % 3;
              clip.press(cr < r ? 'ArrowDown' : cr > r ? 'ArrowUp' : cc < c ? 'ArrowRight' : cc > c ? 'ArrowLeft' : 'Space');
              await clip.sleep(260);
            }
          },
        },
        {
          name: 'keeping time on the tambourine', seconds: 4,
          setup: async () => {
            const clip = window.__clip;
            const until = async (test, frames = 600) => { for (let i = 0; i < frames && !test(); i++) await clip.frame(); };
            clip.press('Escape'); await until(() => window.saltmarsh.state.mode === 'town');
            Object.assign(window.saltmarsh.state.player, { x: 480, y: 434 });
            await clip.frame();
            for (let i = 0; i < 40 && window.saltmarsh.state.mode !== 'tamb'; i++) { if (window.saltmarsh.state.dialog || window.saltmarsh.state.mode === 'town') clip.press('KeyE'); await clip.sleep(150); }
            await until(() => window.saltmarsh.state.mode === 'tamb');
            await until(() => window.saltmarsh.state.mini.t > -0.3);
          },
          play: async () => {
            const clip = window.__clip;
            const end = performance.now() + 3900;
            while (performance.now() < end) {
              const m = window.saltmarsh.state.mini;
              if (window.saltmarsh.state.mode !== 'tamb' || m.phase !== 'play') break;
              const next = m.notes.find(note => !note.res);
              if (next && Math.abs(m.t - next.time) < 0.04) { clip.press('Space'); await clip.sleep(90); }
              await clip.frame();
            }
          },
        },
        {
          name: 'the centred-photo shutter', seconds: 4,
          setup: async () => {
            const clip = window.__clip;
            const until = async (test, frames = 600) => { for (let i = 0; i < frames && !test(); i++) await clip.frame(); };
            clip.press('Escape'); await until(() => window.saltmarsh.state.mode === 'town');
            Object.assign(window.saltmarsh.state.player, { x: 760, y: 382 });
            await clip.frame();
            for (let i = 0; i < 40 && window.saltmarsh.state.mode !== 'shutter'; i++) { if (window.saltmarsh.state.dialog || window.saltmarsh.state.mode === 'town') clip.press('KeyE'); await clip.sleep(150); }
            await until(() => window.saltmarsh.state.mode === 'shutter');
          },
          play: async () => {
            const clip = window.__clip, PIER_X = 480;
            const end = performance.now() + 3900;
            await clip.sleep(900);
            while (performance.now() < end) {
              const m = window.saltmarsh.state.mini;
              if (window.saltmarsh.state.mode !== 'shutter' || m.phase === 'done') break;
              // Press the shutter when the swaying frame is dead centre.
              if (m.phase === 'aim' && Math.abs(m.fx - PIER_X) <= 3) clip.press('Space');
              await clip.frame();
            }
          },
        },
      ],
    },
  },
};
