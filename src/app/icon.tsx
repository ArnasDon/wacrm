import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  const logo = await fetch(
    "https://raw.githubusercontent.com/periyardasank/wacrm/main/public/Digital%20Magnet.png"
  ).then((res) => res.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={`data:image/png;base64,${Buffer.from(logo).toString("base64")}`}
          width="32"
          height="32"
          style={{ objectFit: "contain" }}
        />
      </div>
    ),
    { ...size },
  );
}
