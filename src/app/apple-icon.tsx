import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

/**
 * iOS ana ekran simgesi. iOS yalnızca PNG kabul ettiği için derleme sırasında
 * üretilir.
 *
 * Simge metin değil, yol (path) olarak çizilmiş bir SVG'den gelir — böylece
 * derleme sırasında hiçbir yazı tipi indirilmesi gerekmez ve internet erişimi
 * olmayan bir sunucuda da sorunsuz derlenir.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const svg = fs.readFileSync(
    path.join(process.cwd(), "public", "icon.svg"),
    "utf8",
  );
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUri} width={180} height={180} alt="" />
      </div>
    ),
    size,
  );
}
