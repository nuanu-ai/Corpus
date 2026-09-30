import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Corpus platform overview";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background:
            "radial-gradient(circle at top left, rgba(111, 255, 199, 0.18), transparent 30%), radial-gradient(circle at bottom right, rgba(64, 132, 255, 0.16), transparent 28%), linear-gradient(135deg, #07111f 0%, #0d1726 45%, #111f34 100%)",
          color: "#f8fafc",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            opacity: 0.18,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "56px 64px",
            width: "100%",
            height: "100%",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  width: 74,
                  height: 74,
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(135deg, #67f7c5, #3b82f6)",
                  color: "#07111f",
                  fontSize: 32,
                  fontWeight: 800,
                }}
              >
                AI
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    fontSize: 20,
                    color: "#9fb1c9",
                    textTransform: "uppercase",
                    letterSpacing: 3,
                  }}
                >
                  Agent-first operating system
                </div>
                <div style={{ fontSize: 34, fontWeight: 700 }}>Corpus</div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.06)",
                padding: "12px 18px",
                color: "#d9e6f7",
                fontSize: 18,
              }}
            >
              Company-DB
            </div>
          </div>

          <div style={{ display: "flex", gap: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div
                style={{
                  fontSize: 72,
                  lineHeight: 1.05,
                  fontWeight: 800,
                  letterSpacing: -2.8,
                  maxWidth: 720,
                }}
              >
                Company data, documents, connectors, and agent workflows.
              </div>

              <div
                style={{
                  marginTop: 26,
                  fontSize: 30,
                  lineHeight: 1.35,
                  color: "#bfd0e4",
                  maxWidth: 820,
                }}
              >
                Ingest evidence, promote verified outputs into Company-DB, search narrative and structured data correctly,
                and keep approvals and audit trails in one system.
              </div>
            </div>

            <div
              style={{
                width: 330,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {[
                "Documents and ingestion",
                "Connectors and live systems",
                "Git-backed Company-DB",
                "Approvals and operator controls",
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 18px",
                    borderRadius: 20,
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    fontSize: 22,
                    color: "#edf4ff",
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: "#67f7c5",
                    }}
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 22,
              color: "#a9bdd5",
            }}
          >
            <div>Finance stays structured-first. Narrative search stays Company-DB mediated.</div>
            <div>corpus.example</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
