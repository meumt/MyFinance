import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

/** Sekme simgesi (favicon). Yazı tipi gerektirmeyen SVG'den üretilir. */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  const svg = fs.readFileSync(
    path.join(process.cwd(), "public", "icon.svg"),
    "utf8",
  );
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUri} width={64} height={64} alt="" />
      </div>
    ),
    size,
  );
}
