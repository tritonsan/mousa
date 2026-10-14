# Pictures

Moûsa writes the image brief from the imagery device itself: its look, its colours and the qualities it translates. The measured tags, rather than a work's name, therefore direct the picture. You describe only what the picture shows.

## Before you plan pictures

`mousa_status` lists the image sources of this session:

| Source | When | How |
| --- | --- | --- |
| `host-tool` | Codex always has an image tool. Claude Code and other hosts have one only when the session does, such as an image MCP server | `image` prompt, then your own tool, then `image` register |
| `codex-cli` | A signed-in Codex CLI on this machine, outside Codex | `image({ action: 'generate', ... })` |
| `off` | No image tool, a hosted server, or `MOUSA_IMAGES=off` | The plan's fallback: an SVG drawing or CSS art |

Plan `generated-image` only when you can really make a picture in this session. Otherwise plan `inline-svg` or `css-art` for the device.

## The flow

1. **Declare.** In the imagery device, list the pictures you plan in `tokens.images` as `generated/<device id>-1.png`, `-2.png` and so on. These are the names `image` gives them.
2. **Ask for the brief.** Call `image({ action: 'prompt', device: 'dna4', subject: 'Stepped stone terraces under low mist at dawn', aspect: 'landscape' })`. It returns `brief`, `saveAs` and how to proceed on this host.
   - `subject` is one sentence, 10-240 characters, on what the picture shows: things, places, light and texture.
   - The subject never names a work, artist or brand from the taste data, and Moûsa refuses one that does. It never names a tool either.
   - `aspect` is `landscape` (3:2), `portrait` (2:3) or `square` (1:1).
3. **Make it.** Use your own image tool with the brief as the prompt, and save the file at `saveAs`, inside the project. In Codex, copy the picture from where the image tool saved it.
4. **Register it.** Call `image({ action: 'register', device: 'dna4', path: 'generated/dna4-1.png' })`.
   - The file must be a PNG or JPEG of at most 20 MB.
   - Moûsa compares the picture's main colours with the device's palette. At least two of them should lie within ΔE 22 of its colours.
   - When they do not, make the picture again from the brief, or treat it with the palette where it is shown, such as a filter or blend over two of the device's colours.
5. **Use it.** Show every registered picture in the device it was made for, with its width and height and honest `alt` text.

With a signed-in Codex CLI outside Codex, `image({ action: 'generate', device, subject, aspect })` does steps 2-4 in one call. It takes about a minute.

## Limits

- **How many.** A step's `count` caps its device's pictures, and the session caps all pictures (4 by default, up to 8 with `MOUSA_IMAGES_PER_RUN`).
- **What a picture carries.** No text, logos, recognisable people or copyrighted characters. Generated pictures are original, not a still or poster of a work.
- **When a picture cannot be made.** Build the device by its step's fallback, and say so in the review. The check will report the declared picture as missing.
