export type NameResult = { name: string; reason: string };

const SYSTEM = `You name Windows screenshots so people can find them later.
Reply with JSON only: {"name":"kebab-case-filename-stem","reason":"one short sentence"}.
Rules for name: English kebab-case, 3–8 words, no dates, no extension, describe the UI or content (app, error, dialog).`;

export async function nameScreenshot(
  imageB64: string,
  opts: { ollamaUrl?: string; model?: string } = {},
): Promise<NameResult> {
  const ollamaUrl = (opts.ollamaUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = opts.model ?? "gemma3:4b";
  const res = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0, seed: 7 },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: "Name this screenshot.",
          images: [imageB64],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = data.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { name?: string; reason?: string };
  if (!parsed.name) throw new Error("model returned no name");
  return { name: parsed.name, reason: parsed.reason ?? "" };
}
