import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * BRANDED QUOTE CARDS — free, no AI image generation needed.
 *
 * satori renders JSX-like objects to SVG, resvg rasterizes to PNG. Both run
 * locally with no API. Posts with images consistently outperform text-only,
 * and this keeps every card exactly on-brand.
 *
 * Fonts: drop .ttf files into image/fonts/. Defaults look for Inter; falls
 * back to any DejaVu install on the system.
 */

const BRAND = {
  bg: "#0A0A0A",
  accent: "#FFD400", // GameReq yellow
  text: "#FFFFFF",
  muted: "#8A8A8A",
};

async function loadFonts() {
  const candidates = [
    { name: "Inter", file: path.join(__dirname, "fonts", "Inter-Bold.ttf"), weight: 700 },
    { name: "Inter", file: path.join(__dirname, "fonts", "Inter-Regular.ttf"), weight: 400 },
    // System fallbacks
    { name: "DejaVu Sans", file: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", weight: 700 },
    { name: "DejaVu Sans", file: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", weight: 400 },
  ];

  const fonts = [];
  const loadedWeights = new Set();

  for (const c of candidates) {
    if (loadedWeights.has(c.weight)) continue;
    try {
      const data = await readFile(c.file);
      fonts.push({ name: c.name, data, weight: c.weight, style: "normal" });
      loadedWeights.add(c.weight);
    } catch {
      /* try next candidate */
    }
  }

  if (!fonts.length) {
    throw new Error(
      "No fonts found. Put Inter-Bold.ttf and Inter-Regular.ttf in image/fonts/"
    );
  }
  return fonts;
}

/** Scales font size down as the hook gets longer, so it always fits. */
function fitFontSize(text) {
  const len = text.length;
  if (len < 45) return 62;
  if (len < 70) return 52;
  if (len < 100) return 44;
  return 36;
}

function buildTemplate({ hook, handle, pillar, fontFamily }) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "1200px",
        height: "675px",
        backgroundColor: BRAND.bg,
        padding: "72px",
        fontFamily,
        position: "relative",
      },
      children: [
        // Accent bar
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: "1200px",
              height: "10px",
              backgroundColor: BRAND.accent,
            },
          },
        },
        // Pillar label
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: "22px",
              fontWeight: 700,
              color: BRAND.accent,
              letterSpacing: "3px",
              textTransform: "uppercase",
            },
            children: pillar,
          },
        },
        // The hook
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: `${fitFontSize(hook)}px`,
              fontWeight: 700,
              color: BRAND.text,
              lineHeight: 1.25,
              maxWidth: "1010px",
            },
            children: hook,
          },
        },
        // Footer
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", fontSize: "26px", color: BRAND.muted, fontWeight: 400 },
                  children: handle,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: "26px",
                    fontWeight: 700,
                    color: BRAND.bg,
                    backgroundColor: BRAND.accent,
                    padding: "10px 22px",
                    borderRadius: "6px",
                  },
                  children: "GameReq",
                },
              },
            ],
          },
        },
      ],
    },
  };
}

/**
 * Returns a PNG Buffer of the branded quote card.
 */
export async function generateCard({ hook, pillar = "", handle = "@yourhandle" }) {
  const fonts = await loadFonts();
  const fontFamily = fonts[0].name;

  const svg = await satori(
    buildTemplate({ hook, handle, pillar: pillar.toUpperCase(), fontFamily }),
    { width: 1200, height: 675, fonts }
  );

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  return resvg.render().asPng();
}
