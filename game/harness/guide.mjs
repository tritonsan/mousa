// The character format guide the designing model reads as format.md. Ranges and names come from the validator's
// own constants, so the guide cannot drift from what game_write_file accepts.

import { BONES, JOINTS, CLIP_NAMES, ROTATION_TRACKS, EASING_NAMES, TURN_STYLES, EFFECT_KINDS, PARTICLE_SHAPES, LINE_KEYS, LIMITS, MOTION_RANGES, MOTION_UNITS, SCENE_RULES } from '../src/format.js';
import { WEATHER_KINDS, WEATHER_NOTES, TOWER_STYLES, TOWER_NOTES, RENDER_PRESETS, RENDER_NAMES, DEFAULT_SCENE } from '../src/scene.js';

const range = ([low, high]) => `${low} to ${high}`;
const table = (rows, header) => [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');

/** The moment's art direction: the scene, the render style and the music, with the vocabularies the validator accepts. */
function artDirectionGuide({ music }) {
  const weather = table(WEATHER_KINDS.map(kind => [`\`${kind}\``, WEATHER_NOTES[kind]]), ['Weather', 'What falls or floats']);
  const towers = table(TOWER_STYLES.map(style => [`\`${style}\``, TOWER_NOTES[style]]), ['Towers', 'Form of the beacon and the far towers']);
  const presets = table(RENDER_NAMES.map(name => [`\`${name}\``, RENDER_PRESETS[name].note, RENDER_PRESETS[name].words.length ? RENDER_PRESETS[name].words.slice(0, 8).join(', ') : 'nothing: the default']),
    ['Preset', 'How the frame is drawn', 'Art styles that name it']);
  return `
## Art direction: scene, render style${music ? ' and music' : ''}

The moment's lore, layout and beats are fixed: the road, the bridge, the bench, the beacon and the far towers stand where they always do, and the story plays the same way. Your file sets how that moment looks${music ? ' and sounds' : ''}.

\`scene\` paints the world from a few anchor colours. Every world colour follows its anchor by the same shift in CIE Lab, so a violet dusk keeps the contrasts of the original teal one.

| Field | Value |
| --- | --- |
| sky | required: \`[zenith, horizon]\`, the top of the sky and the horizon. It is always dusk: the zenith is at least ${SCENE_RULES.duskContrast} CIE L* darker than the horizon |
| sun | the low sun's disc, half sunk in the cloud sea |
| clouds | required: the cloud sea below the cliffs |
| rock | required: the basalt of the cliffs and the road, CIE L* at most ${SCENE_RULES.rockLightness} |
| foliage | required: moss, grass and vines |
| rim | the sunlit edges of the rock |
| flags | ${SCENE_RULES.flags[0]} to ${SCENE_RULES.flags[1]} prayer flag colours |
| weather | required: \`{kind, density, color}\`; density 0 to 1, where 0.4 is a moderate amount; color is optional |
| fog | 0 to 1: mist at the foot of the spires and over the road |
| towers | the form of the beacon and the far towers, default \`stone\` |

${weather}

${towers}

The original dusk is \`{"sky": ${JSON.stringify(DEFAULT_SCENE.sky)}, "sun": "${DEFAULT_SCENE.sun}", "clouds": "${DEFAULT_SCENE.clouds}", "rock": "${DEFAULT_SCENE.rock}", "foliage": "${DEFAULT_SCENE.foliage}", "rim": "${DEFAULT_SCENE.rim}", "weather": {"kind": "fireflies", "density": 0.4}, "towers": "stone"}\`. The lamplighter's light still pushes the dusk back and kindles the beacon in its own colour, so keep the scene dark enough for the flame to matter.

\`render\` is \`{"preset": name}\`: the style the whole frame is drawn in, the world and both characters alike. A character drawn without its own outline gets the style's ink line where the style has one.

${presets}

A render device anchored to an art style draws in the preset that art style's name names, by the words above: Pixel Art and HD-2D name \`pixel\`, Cel-Shaded and Anime-Style name \`cel\`, Watercolor and Painterly name \`watercolor\`. An art style that names none, such as Stylized or 3D, leaves the choice to you.
${music ? `
\`music\` is \`{"track": id, "volume": 0.1 to 1}\`, with the volume 0.6 when left out. The track is an ID from \`music.json\`, an open music library whose genres and tags come from each track's own catalogue. The track loops through the moment once the player turns the sound on.
` : ''}`;
}

/** The title card's portrait: a picture in the game folder, which the play page shows above the title. */
function portraitGuide(canon) {
  return `
## Portrait

\`portrait\` is optional: a picture of ${canon.character.name} that the play page shows above the title, \`{"src": "generated/<name>.png", "alt": "what it shows"}\`. The picture is a PNG or JPEG in the game folder, square works best, and \`alt\` describes it in 10 to 200 characters. It shows the same character as the drawing: its palette, its silhouette and its light. Leave the field out for no portrait.
`;
}

export function formatGuide({ canon, keeperHeight, artDirection = false, music = false, portrait = false }) {
  const walk = table(Object.entries(MOTION_RANGES.walk).map(([key, bounds]) => [`walk.${key}`, range(bounds), MOTION_UNITS.walk[key]]), ['Parameter', 'Range', 'Meaning']);
  const idle = table(Object.entries(MOTION_RANGES.idle).map(([key, bounds]) => [`idle.${key}`, range(bounds), MOTION_UNITS.idle[key]]), ['Parameter', 'Range', 'Meaning']);
  return `# Character format ${'1.0'} for The Long Dusk

You write one JSON file, \`character.json\`, that the game loads for ${canon.character.name} the ${canon.character.role.toLowerCase()}. The engine, the world${artDirection ? '\'s layout and story' : ''}, the camera and the keeper are fixed and shared; your file supplies the drawing, proportions, colours, cloth, the carried light, motion parameters, three keyframed clips, particle effects and four lines${artDirection ? `, and the moment's art direction: the scene, the render style${music ? ' and the music' : ''}` : ''}. \`game_write_file\` validates the file and names the first field that needs a fix. \`game_check_character\` then measures the character, draws three text previews and checks it against your DNA.

The game is a side view. ${canon.character.name} walks right along a basalt cliff road at dusk, stops to talk with ${canon.keeper.name}, the ${canon.keeper.role.toLowerCase()}, walks on to the cold beacon and wakes it with the signature move. The flame leaves ${canon.character.name}'s light, rises to the beacon's bowl and lights the lanterns and the far towers in the light's colour.

## Coordinates and scale

- x grows to the right and the character faces +x. y grows downward and the ground is y = 0, so everything above the ground has a negative y. Put x = 0 under the hip.
- Draw the bind pose: standing in profile facing right, arms hanging at the sides, feet on the ground. Every part is drawn in these same absolute coordinates; the engine animates by turning bones around their joints, as cut-out animation does.
- ${canon.keeper.name} stands about ${Math.round(keeperHeight)} units tall, a little stooped. One unit is roughly a centimetre, but a character can be any size from 60 to 280 units.
- The comparison view shows about 550 units of height, and the full-screen view about 720, so a 180-unit figure fills a quarter to a third of the view. Details narrower than 3 units disappear; the outline must read at a glance.

## Skeleton

\`skeleton\` gives the ten joints as [x, y]: ${JOINTS.join(', ')}. The toe rests on the ground (y from -8 to 4) in front of the ankle. Each joint sits above the one below it: ankle above toe, knee above ankle, hip above knee, chest and neck above the hip, head above the neck, the elbow below the shoulder, and the shoulder between the neck and the hip. Thigh plus shin is 20 to 160 units; the gait scales with leg length.

| Bone | Turns around | Points to |
| --- | --- | --- |
| pelvis | hip | straight down from the hip |
| torso | hip | chest |
| head | neck | head |
| upperArm | shoulder | elbow |
| forearm | elbow | wrist |
| hand | wrist | beyond the wrist, along the forearm |
| thigh | hip | knee |
| shin | knee | ankle |
| foot | ankle | toe |

## Parts

\`parts\` is an array of ${4} to ${LIMITS.parts} shapes. Each part needs at least \`id\`, \`bone\`, \`shape\` and \`fill\`.

| Field | Value |
| --- | --- |
| id | lowercase letters, digits and hyphens, unique across parts and cloth |
| bone | one of ${BONES.join(', ')} |
| side | for limb bones: \`both\` (default) draws a near copy and a far copy, \`front\` only the near limb, \`back\` only the far limb |
| z | -20 to 20, higher draws on top; far copies of limbs draw 40 lower, so they always sit behind the body |
| shape | \`path\` with \`d\`; \`capsule\` with \`from\`, \`to\`, \`r1\` and optional \`r2\` (a tapered limb segment); \`ellipse\` with \`center\`, \`rx\`, \`ry\` and optional \`rotation\` in degrees; \`circle\` with \`center\` and \`r\` |
| fill | a palette name, a hex colour, or \`"none"\` for a stroke-only line |
| stroke, strokeWidth | optional outline colour and width (0 to 10) |
| opacity | 0.05 to 1 |
| role | \`"eye"\`: the part blinks, scaling flat around its own centre. Give the eye and any eye shine this role. |
| spring | \`{pivot: [x, y], stiffness, damping, gain}\` (0 to 1, 0 to 1, 0 to 2): the part swings around the pivot as the body moves, for a hat tip, an ear, a feather or a charm |

- Every character needs at least one part on the torso, head, thigh, shin, upperArm and forearm bones.
- Path data uses M, L, H, V, C, S, Q, T, A and Z, absolute or relative, at most 400 commands and 4,000 characters per path and ${LIMITS.totalCommands.toLocaleString('en-US')} commands in all. Coordinates stay within ${LIMITS.coordinate} units of the origin. A subpath inside another draws a hole only when it winds the other way.
- A part follows its bone, so a limb part must cover its joints: a capsule from joint to joint never gaps when the limb bends. Head parts should reach down to the neck joint.
- A good z plan: far cloth -10, legs 0, torso 2, near arm 5, head 10 to 15, and each detail 1 above the shape it sits on. A prop held in the near hand uses side \`front\`.
- \`strokeWidth: 0\` without a stroke keeps a small detail, such as a blush, out of the outline style.

## Palette and style

\`palette\` names 3 to ${LIMITS.palette} colours, \`{"name": "#rrggbb"}\`, with lowercase names. Parts may use a palette name or a hex colour. \`style\` is optional: \`outline\` \`{color, width}\` (0.5 to 5) draws a contour around every filled part for a drawn, cartoon look, or \`null\`; \`backShade\` (0 to 0.7) darkens far limbs toward the dusk; \`shadow\` (0 to 1) is the ground shadow's strength.

## Cloth

\`cloth\` holds up to ${LIMITS.cloth} simulated chains drawn as ribbons: capes, coat tails, scarves, hair, ribbons, straps and ropes. The cliff wind blows toward -x. Each chain needs at least \`id\`, \`bone\`, \`anchor\`, \`segments\`, \`length\`, \`width\` and \`fill\`, a lantern rope included.

| Field | Value |
| --- | --- |
| id, bone, side | as for parts; limb chains use \`front\` (default) or \`back\` |
| anchor | where the chain starts, in bind-pose coordinates on its bone |
| segments | 2 to 14 links |
| length | 6 to 240 units in all |
| width | \`[start, end]\`, 0.5 to 90 units each |
| fill | required: a palette name or a hex colour |
| stripes | optional: 2 to 4 colours drawn in alternating bands in place of the fill |
| stroke, strokeWidth, opacity | as for parts |
| rest | the direction it points at rest, in degrees in the bone's frame: 90 hangs straight down, 135 down and back, 180 straight back |
| stiffness | 0 to 1: how strongly it keeps its rest direction (a stiff coat tail) instead of only hanging and trailing |
| damping, gravity, wind | 0 to 1, 0 to 2, 0 to 2 |
| z | -20 to 20, default -10 (behind the body) |
| tip | 1 to ${LIMITS.tipShapes} shapes drawn at the chain's end in its own frame: (0, 0) is the end, +y points along the chain away from the anchor, x across it |

A hanging lantern is a short rope (segments 2, stiffness 0) on the hand bone with the lantern drawn as tip shapes below (0, 0).

## Light

\`light\` is required for ${canon.character.name}: \`{color, radius, intensity, flicker, attach}\`. The radius is 60 to 420 units, intensity 0.2 to 1.5, and \`flicker\` is \`{speed, amount}\` (0 to 14, 0 to 0.6). \`attach\` is \`{bone, side, offset}\`, where \`offset\` is a point on that bone in bind-pose coordinates like a part's, or \`{cloth, offset}\` for a point in a chain's tip frame. The light pushes the dusk back around the character, its colour becomes the beacon's flame and the far towers answer in it. Draw the source visibly: a glass, flame or ember in a light, saturated colour at the light's position.

## Motion

Every motion parameter is required. The engine owns the gait: planted feet through leg IK, pelvis bob, lean, arm swing, idle breathing, weight shifts, glances and blinks. These parameters give it a personality.

${walk}

${idle}

- \`turn\`: \`{style, duration}\` with style ${TURN_STYLES.map(style => `\`${style}\``).join(', ')} (flip is instant, squash narrows and stretches through the turn, pivot eases around with a small rise) and a duration of 0 to 0.6 seconds.
- \`carry\` (optional): \`{arm: "front" | "back", upperArm, forearm, hand}\` in degrees holds one arm in a pose while walking, for a staff, a lantern held out or a book under the arm.
- The stride per gait cycle is 2 x speed / cadence and is kept between 0.6 and 2.2 leg lengths; 0.8 to 1.8 looks natural, beyond that the feet slide or scuff.

## Rotations

Clip tracks and \`carry\` are degrees relative to the drawn pose. Positive turns clockwise on screen while the character faces right:

- A hanging arm: negative swings it forward and up (-90 points straight ahead, -180 straight up); positive swings it back.
- A forearm: negative bends the elbow so the hand comes forward and up.
- Torso and head: positive tips forward (a bow or a nod), negative leans back.
- A thigh: negative lifts the knee forward; a shin: positive bends the knee so the foot goes back.

## Clips

\`clips\` holds ${CLIP_NAMES.map(name => `\`${name}\``).join(', ')}. \`signature\` is required: the kindling move, played when ${canon.character.name} wakes the beacon. \`greet\` plays as ${canon.character.name} answers the keeper, and \`fidget\` now and then while standing still.

| Field | Value |
| --- | --- |
| duration | 0.4 to 8 seconds |
| kindleAt | signature only: the second the flame leaves the light for the beacon |
| tracks | \`{track: [[t, degrees, ease?], ...]}\`, 1 to ${LIMITS.keys} keys in time order. Tracks: ${ROTATION_TRACKS.join(', ')} |
| root | optional \`[[t, dx, dy, ease?], ...]\` moving the whole body; negative dy lifts it (a hop) |
| squash | optional \`[[t, scale, ease?], ...]\`, 0.5 to 1.5 vertical scale with the volume kept |
| events | optional \`[{t, emit}]\`, up to ${LIMITS.events}, firing a burst effect by its ID |

Easings are ${EASING_NAMES.map(name => `\`${name}\``).join(', ')} or a cubic-bezier \`[x1, y1, x2, y2]\`, and shape the move from that key to the next. A track takes over its bone from its first key to its last, blending in and out over 0.14 seconds, so keys at 0 and at the end make the clip own the bone throughout; legs not in the clip stay with the gait. ${canon.character.name} kindles standing about 94 units left of the beacon's plinth, whose bowl is about 430 units above the road, so the flame leaves the light at kindleAt and arcs up and to the right. Raise, throw, offer, bow or strike: the move is yours.

## Effects

\`effects\` holds up to ${LIMITS.effects} particle emitters.

| Field | Value |
| --- | --- |
| id | unique ID |
| kind | ${EFFECT_KINDS.map(kind => `\`${kind}\``).join(', ')}: footstep puffs at each footfall, trail while walking, aura all the time, burst only from clip events |
| shape | ${PARTICLE_SHAPES.join(', ')} |
| colors | 1 to 4 colours |
| size, life, speed | \`[min, max]\`: 0.5 to 30 units, 0.1 to 6 seconds, 0 to 400 units per second |
| rate | particles per event for bursts (1 to 80) and per step for footsteps (1 to 12), per second for trails and auras (0.5 to 60) |
| spread, direction | 0 to 360 degrees; -180 to 180 with -90 straight up |
| gravity, drag | -400 to 400 (negative floats up), 0 to 1 |
| blend | \`add\` glows, \`normal\` covers |
| attach | the light by default; \`{bone, side, offset}\` or \`{cloth, offset}\`. Footsteps always start at the feet. |

## Lines

\`lines\` needs all four, 2 to 160 characters each: ${LINE_KEYS.map(key => `\`${key}\``).join(', ')}.

- \`arrive\`: a subtitle as ${canon.character.name} steps onto the cliff road.
- \`greet\`: ${canon.character.name}'s answer to ${canon.keeper.name}: "${canon.script.keeperGreeting}" She then says: "${canon.script.keeperRequest}"
- \`kindle\`: spoken as the signature move plays.
- \`after\`: ${canon.character.name}'s answer to "${canon.script.keeperAfter}"
${artDirection ? artDirectionGuide({ music }) : ''}${portrait ? portraitGuide(canon) : ''}
## Fixed fields and limits

\`schemaVersion\` "1.0", \`id\` (lowercase), \`name\` "${canon.character.name}", \`role\` "${canon.character.role}" and \`description\` (20 to 400 characters of plain text) are required${artDirection ? `, and so are ${music ? '`scene`, `render` and `music`' : '`scene` and `render`'}` : ''}. The file is at most ${LIMITS.bytes.toLocaleString('en-US')} bytes, and the drawn character, props included, stands 60 to 280 units tall. Text never contains angle brackets.

## What game_check_character reports

- Figure height: the top of the highest part on any bone except the hand, so a staff held overhead does not count. Head share: the vertical extent of the head bone's parts (hair, hats and hoods included) divided by the figure height. Leg share: hip height over figure height.
- Three text previews: \`rest\` after standing two seconds, \`walk\` at the widest step, and \`kindle\` at the kindling moment. Each cell shows the top-most part's symbol from the legend; far copies of limbs are lowercase, and the ground is a row of dashes. Cells are half as wide as they are tall, like text, so proportions hold.
- Warnings for joints a limb does not cover, a head that does not reach the neck, feet off the ground, no blinking eye, cloth anchored in the air, parts hidden at rest, and a stride the engine has to clamp.
- Conformance with your DNA: which devices' tokens are present, partial or missing.${artDirection ? ' Scene tokens are checked against `scene` (the sky colours in order, other colours among the scene\'s, the weather kind, the towers and the fog), render tokens against `render.preset` and music tokens against `music.track`.' : ''}

## Craft

- Silhouette first: the character must read as a single dark shape at 60 pixels tall. Vary the outline: a hat, a hood, a pack, a staff, a coat's hem.
- Layer each mass: a base shape, a darker shade along the back (-x side) and underside, and a lighter edge or highlight on the +x side, where the light falls.
- Keep the face in profile on the +x side of the head, with the eye marked \`role: "eye"\`.
- Draw limbs as capsules from joint to joint; draw sleeves and trousers over them only where they cover the joint too.
- The file \`mannequin.json\` is a plain, valid example of every section. Its look is deliberately featureless: use it to read the format, not as a starting design.
`;
}
