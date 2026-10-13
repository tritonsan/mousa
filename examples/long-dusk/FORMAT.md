# Character format 1.0 for The Long Dusk

You write one JSON file, `characters/ilo.json`, that the game loads for Ilo the lamplighter. The engine, the world's layout and story, the camera and the keeper are fixed and shared; your file supplies the drawing, proportions, colours, cloth, the carried light, motion parameters, three keyframed clips, particle effects and four lines, and the moment's art direction: the scene, the render style. The game validates the file whenever a page loads it: an invalid file stops the page and names the first field that needs a fix, and a capture of `capture.html` shows that message.

The game is a side view. Ilo walks right along a basalt cliff road at dusk, stops to talk with Maren, the keeper of the vesper beacon, walks on to the cold beacon and wakes it with the signature move. The flame leaves Ilo's light, rises to the beacon's bowl and lights the lanterns and the far towers in the light's colour.

## Coordinates and scale

- x grows to the right and the character faces +x. y grows downward and the ground is y = 0, so everything above the ground has a negative y. Put x = 0 under the hip.
- Draw the bind pose: standing in profile facing right, arms hanging at the sides, feet on the ground. Every part is drawn in these same absolute coordinates; the engine animates by turning bones around their joints, as cut-out animation does.
- Maren stands about 156 units tall, a little stooped. One unit is roughly a centimetre, but a character can be any size from 60 to 280 units.
- The comparison view shows about 550 units of height, and the full-screen view about 720, so a 180-unit figure fills a quarter to a third of the view. Details narrower than 3 units disappear; the outline must read at a glance.

## Skeleton

`skeleton` gives the ten joints as [x, y]: hip, chest, neck, head, shoulder, elbow, wrist, knee, ankle, toe. The toe rests on the ground (y from -8 to 4) in front of the ankle. Each joint sits above the one below it: ankle above toe, knee above ankle, hip above knee, chest and neck above the hip, head above the neck, the elbow below the shoulder, and the shoulder between the neck and the hip. Thigh plus shin is 20 to 160 units; the gait scales with leg length.

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

`parts` is an array of 4 to 80 shapes. Each part needs at least `id`, `bone`, `shape` and `fill`.

| Field | Value |
| --- | --- |
| id | lowercase letters, digits and hyphens, unique across parts and cloth |
| bone | one of pelvis, torso, head, upperArm, forearm, hand, thigh, shin, foot |
| side | for limb bones: `both` (default) draws a near copy and a far copy, `front` only the near limb, `back` only the far limb |
| z | -20 to 20, higher draws on top; far copies of limbs draw 40 lower, so they always sit behind the body |
| shape | `path` with `d`; `capsule` with `from`, `to`, `r1` and optional `r2` (a tapered limb segment); `ellipse` with `center`, `rx`, `ry` and optional `rotation` in degrees; `circle` with `center` and `r` |
| fill | a palette name, a hex colour, or `"none"` for a stroke-only line |
| stroke, strokeWidth | optional outline colour and width (0 to 10) |
| opacity | 0.05 to 1 |
| role | `"eye"`: the part blinks, scaling flat around its own centre. Give the eye and any eye shine this role. |
| spring | `{pivot: [x, y], stiffness, damping, gain}` (0 to 1, 0 to 1, 0 to 2): the part swings around the pivot as the body moves, for a hat tip, an ear, a feather or a charm |

- Every character needs at least one part on the torso, head, thigh, shin, upperArm and forearm bones.
- Path data uses M, L, H, V, C, S, Q, T, A and Z, absolute or relative, at most 400 commands and 4,000 characters per path and 6,000 commands in all. Coordinates stay within 320 units of the origin. A subpath inside another draws a hole only when it winds the other way.
- A part follows its bone, so a limb part must cover its joints: a capsule from joint to joint never gaps when the limb bends. Head parts should reach down to the neck joint.
- A good z plan: far cloth -10, legs 0, torso 2, near arm 5, head 10 to 15, and each detail 1 above the shape it sits on. A prop held in the near hand uses side `front`.
- `strokeWidth: 0` without a stroke keeps a small detail, such as a blush, out of the outline style.

## Palette and style

`palette` names 3 to 14 colours, `{"name": "#rrggbb"}`, with lowercase names. Parts may use a palette name or a hex colour. `style` is optional: `outline` `{color, width}` (0.5 to 5) draws a contour around every filled part for a drawn, cartoon look, or `null`; `backShade` (0 to 0.7) darkens far limbs toward the dusk; `shadow` (0 to 1) is the ground shadow's strength.

## Cloth

`cloth` holds up to 8 simulated chains drawn as ribbons: capes, coat tails, scarves, hair, ribbons, straps and ropes. The cliff wind blows toward -x. Each chain needs at least `id`, `bone`, `anchor`, `segments`, `length`, `width` and `fill`, a lantern rope included.

| Field | Value |
| --- | --- |
| id, bone, side | as for parts; limb chains use `front` (default) or `back` |
| anchor | where the chain starts, in bind-pose coordinates on its bone |
| segments | 2 to 14 links |
| length | 6 to 240 units in all |
| width | `[start, end]`, 0.5 to 90 units each |
| fill | required: a palette name or a hex colour |
| stripes | optional: 2 to 4 colours drawn in alternating bands in place of the fill |
| stroke, strokeWidth, opacity | as for parts |
| rest | the direction it points at rest, in degrees in the bone's frame: 90 hangs straight down, 135 down and back, 180 straight back |
| stiffness | 0 to 1: how strongly it keeps its rest direction (a stiff coat tail) instead of only hanging and trailing |
| damping, gravity, wind | 0 to 1, 0 to 2, 0 to 2 |
| z | -20 to 20, default -10 (behind the body) |
| tip | 1 to 8 shapes drawn at the chain's end in its own frame: (0, 0) is the end, +y points along the chain away from the anchor, x across it |

A hanging lantern is a short rope (segments 2, stiffness 0) on the hand bone with the lantern drawn as tip shapes below (0, 0).

## Light

`light` is required for Ilo: `{color, radius, intensity, flicker, attach}`. The radius is 60 to 420 units, intensity 0.2 to 1.5, and `flicker` is `{speed, amount}` (0 to 14, 0 to 0.6). `attach` is `{bone, side, offset}`, where `offset` is a point on that bone in bind-pose coordinates like a part's, or `{cloth, offset}` for a point in a chain's tip frame. The light pushes the dusk back around the character, its colour becomes the beacon's flame and the far towers answer in it. Draw the source visibly: a glass, flame or ember in a light, saturated colour at the light's position.

## Motion

Every motion parameter is required. The engine owns the gait: planted feet through leg IK, pelvis bob, lean, arm swing, idle breathing, weight shifts, glances and blinks. These parameters give it a personality.

| Parameter | Range | Meaning |
| --- | --- | --- |
| walk.speed | 50 to 220 | world units per second |
| walk.cadence | 1 to 3.4 | steps per second |
| walk.stepHeight | 0 to 0.4 | share of leg length |
| walk.bob | 0 to 0.16 | share of leg length |
| walk.bounciness | 0 to 1 | 0 heavy and grounded, 1 springy |
| walk.lean | -10 to 25 | degrees, positive leans forward |
| walk.armSwing | 0 to 70 | degrees |
| walk.elbowBend | 0 to 100 | degrees |
| walk.hipSway | 0 to 15 | degrees |
| walk.headStabilize | 0 to 1 | 0 head follows the body, 1 head stays level |
| walk.squash | 0 to 0.2 | share of height at each footfall |
| walk.accel | 0.05 to 1.2 | seconds to reach full speed |

| Parameter | Range | Meaning |
| --- | --- | --- |
| idle.breathRate | 6 to 30 | breaths per minute |
| idle.breathDepth | 0 to 1 | 0-1 |
| idle.sway | 0 to 1 | 0-1 |
| idle.weightShift | 0 to 1 | 0-1 |
| idle.lookAround | 0 to 1 | 0-1 |
| idle.blinkInterval | 1.5 to 9 | seconds |
| idle.stance | 0 to 0.5 | share of leg length between the feet |

- `turn`: `{style, duration}` with style `flip`, `squash`, `pivot` (flip is instant, squash narrows and stretches through the turn, pivot eases around with a small rise) and a duration of 0 to 0.6 seconds.
- `carry` (optional): `{arm: "front" | "back", upperArm, forearm, hand}` in degrees holds one arm in a pose while walking, for a staff, a lantern held out or a book under the arm.
- The stride per gait cycle is 2 x speed / cadence and is kept between 0.6 and 2.2 leg lengths; 0.8 to 1.8 looks natural, beyond that the feet slide or scuff.

## Rotations

Clip tracks and `carry` are degrees relative to the drawn pose. Positive turns clockwise on screen while the character faces right:

- A hanging arm: negative swings it forward and up (-90 points straight ahead, -180 straight up); positive swings it back.
- A forearm: negative bends the elbow so the hand comes forward and up.
- Torso and head: positive tips forward (a bow or a nod), negative leans back.
- A thigh: negative lifts the knee forward; a shin: positive bends the knee so the foot goes back.

## Clips

`clips` holds `signature`, `greet`, `fidget`. `signature` is required: the kindling move, played when Ilo wakes the beacon. `greet` plays as Ilo answers the keeper, and `fidget` now and then while standing still.

| Field | Value |
| --- | --- |
| duration | 0.4 to 8 seconds |
| kindleAt | signature only: the second the flame leaves the light for the beacon |
| tracks | `{track: [[t, degrees, ease?], ...]}`, 1 to 32 keys in time order. Tracks: pelvis, torso, head, upperArmFront, forearmFront, handFront, upperArmBack, forearmBack, handBack, thighFront, shinFront, footFront, thighBack, shinBack, footBack |
| root | optional `[[t, dx, dy, ease?], ...]` moving the whole body; negative dy lifts it (a hop) |
| squash | optional `[[t, scale, ease?], ...]`, 0.5 to 1.5 vertical scale with the volume kept |
| events | optional `[{t, emit}]`, up to 8, firing a burst effect by its ID |

Easings are `linear`, `in`, `out`, `inOut`, `outBack`, `inBack`, `inOutBack`, `outElastic`, `outBounce`, `step` or a cubic-bezier `[x1, y1, x2, y2]`, and shape the move from that key to the next. A track takes over its bone from its first key to its last, blending in and out over 0.14 seconds, so keys at 0 and at the end make the clip own the bone throughout; legs not in the clip stay with the gait. Ilo kindles standing about 94 units left of the beacon's plinth, whose bowl is about 430 units above the road, so the flame leaves the light at kindleAt and arcs up and to the right. Raise, throw, offer, bow or strike: the move is yours.

## Effects

`effects` holds up to 6 particle emitters.

| Field | Value |
| --- | --- |
| id | unique ID |
| kind | `footstep`, `trail`, `aura`, `burst`: footstep puffs at each footfall, trail while walking, aura all the time, burst only from clip events |
| shape | circle, diamond, square, streak, ring, petal |
| colors | 1 to 4 colours |
| size, life, speed | `[min, max]`: 0.5 to 30 units, 0.1 to 6 seconds, 0 to 400 units per second |
| rate | particles per event for bursts (1 to 80) and per step for footsteps (1 to 12), per second for trails and auras (0.5 to 60) |
| spread, direction | 0 to 360 degrees; -180 to 180 with -90 straight up |
| gravity, drag | -400 to 400 (negative floats up), 0 to 1 |
| blend | `add` glows, `normal` covers |
| attach | the light by default; `{bone, side, offset}` or `{cloth, offset}`. Footsteps always start at the feet. |

## Lines

`lines` needs all four, 2 to 160 characters each: `arrive`, `greet`, `kindle`, `after`.

- `arrive`: a subtitle as Ilo steps onto the cliff road.
- `greet`: Ilo's answer to Maren: "Another lamplighter on the cliff road. The last one turned back at the bridge." She then says: "The beacon has been cold three winters. The far towers will not wake until Vesper does."
- `kindle`: spoken as the signature move plays.
- `after`: Ilo's answer to "Look along the cliffs. The far towers are answering."

## Art direction: scene, render style

The moment's lore, layout and beats are fixed: the road, the bridge, the bench, the beacon and the far towers stand where they always do, and the story plays the same way. Your file sets how that moment looks.

`scene` paints the world from a few anchor colours. Every world colour follows its anchor by the same shift in CIE Lab, so a violet dusk keeps the contrasts of the original teal one.

| Field | Value |
| --- | --- |
| sky | required: `[zenith, horizon]`, the top of the sky and the horizon. It is always dusk: the zenith is at least 10 CIE L* darker than the horizon |
| sun | the low sun's disc, half sunk in the cloud sea |
| clouds | required: the cloud sea below the cliffs |
| rock | required: the basalt of the cliffs and the road, CIE L* at most 40 |
| foliage | required: moss, grass and vines |
| rim | the sunlit edges of the rock |
| flags | 2 to 5 prayer flag colours |
| weather | required: `{kind, density, color}`; density 0 to 1, where 0.4 is a moderate amount; color is optional |
| fog | 0 to 1: mist at the foot of the spires and over the road |
| towers | the form of the beacon and the far towers, default `stone` |

| Weather | What falls or floats |
| --- | --- |
| `fireflies` | glowing points drifting low over the road (the default) |
| `snow` | flakes falling slowly in three depths, drifting with the wind |
| `rain` | fast slanted streaks |
| `petals` | petals tumbling down on the wind |
| `leaves` | larger leaves tumbling down |
| `embers` | glowing sparks rising |
| `ash` | grey flakes sinking slowly |
| `motes` | soft dust motes hanging in the air |
| `none` | clear air |

| Towers | Form of the beacon and the far towers |
| --- | --- |
| `stone` | squat banded stone with a shallow bowl (the default) |
| `spire` | a slender needle ringed with bands, the fire held in a cradle of prongs |
| `pagoda` | stacked tiers under upturned eaves, the fire in a lantern room at the top |
| `ruin` | a broken, leaning shaft missing blocks, the fire in a cracked dish |

The original dusk is `{"sky": ["#19213a","#80a99d"], "sun": "#efe7d6", "clouds": "#96a5b5", "rock": "#2a3044", "foliage": "#4a6855", "rim": "#93b9ad", "weather": {"kind": "fireflies", "density": 0.4}, "towers": "stone"}`. The lamplighter's light still pushes the dusk back and kindles the beacon in its own colour, so keep the scene dark enough for the flame to matter.

`render` is `{"preset": name}`: the style the whole frame is drawn in, the world and both characters alike. A character drawn without its own outline gets the style's ink line where the style has one.

| Preset | How the frame is drawn | Art styles that name it |
| --- | --- | --- |
| `lit` | soft light pools in the dusk, a fine grain and a vignette (the default) | nothing: the default |
| `ink` | dark ink outlines on every shape, a warm paper grain and a muted, sepia-leaning tone; the lines boil slightly as if redrawn each frame | hand drawn, traditional animation, ink, sketch, sketchy, line art, storybook, illustrated |
| `watercolor` | soft washes that bleed at the edges, pale pigment and a rough paper texture | watercolor, watercolour, painterly, painted, gouache, pastel, impressionist, oil painting |
| `cel` | bold outlines, light in two or three hard bands, a banded sky and saturated colour | cel shaded, cell shaded, cel shading, cel, toon, anime, cartoon, cartoony |
| `pixel` | the frame drawn at a low resolution with hard pixels, a reduced palette and ordered dithering | pixel, pixel art, pixelated, 8 bit, 16 bit, sprite, spritework, retro |
| `neon` | deep shadows, glowing edges and lights that bloom, with faint scanlines | neon, synthwave, cyberpunk, vaporwave, retrowave, glowing |
| `flat` | flat colour without grain or vignette, light and sky in a few clean steps | minimalist, minimalistic, minimal, minimalism, flat, low poly, poly, geometric |
| `cinematic` | a widescreen letterbox, blooming highlights, a deep vignette, film grain and a graded contrast | cinematic, realistic, photorealistic, high fidelity, filmic, noir, film noir |

A render device anchored to an art style draws in the preset that art style's name names, by the words above: Pixel Art and HD-2D name `pixel`, Cel-Shaded and Anime-Style name `cel`, Watercolor and Painterly name `watercolor`. An art style that names none, such as Stylized or 3D, leaves the choice to you.

## Portrait

`portrait` is optional: a picture of Ilo that the play page shows above the title, `{"src": "generated/<name>.png", "alt": "what it shows"}`. The picture is a PNG or JPEG in the game folder, square works best, and `alt` describes it in 10 to 200 characters. It shows the same character as the drawing: its palette, its silhouette and its light. Leave the field out for no portrait.

## Fixed fields and limits

`schemaVersion` "1.0", `id` (lowercase), `name` "Ilo", `role` "Lamplighter" and `description` (20 to 400 characters of plain text) are required, and so are `scene` and `render`. The file is at most 98,304 bytes, and the drawn character, props included, stands 60 to 280 units tall. Text never contains angle brackets.

## Craft

- Silhouette first: the character must read as a single dark shape at 60 pixels tall. Vary the outline: a hat, a hood, a pack, a staff, a coat's hem.
- Layer each mass: a base shape, a darker shade along the back (-x side) and underside, and a lighter edge or highlight on the +x side, where the light falls.
- Keep the face in profile on the +x side of the head, with the eye marked `role: "eye"`.
- Draw limbs as capsules from joint to joint; draw sleeves and trousers over them only where they cover the joint too.
- `characters/ilo.json` starts as the game's plain grey mannequin, a valid example of every section. Its look is deliberately featureless: read the format from it, and do not keep its shapes as the design.
