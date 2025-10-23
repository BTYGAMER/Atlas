import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let model = "google/gemini-2.5-flash";
    let triedLite = false;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a helpful, knowledgeable AI assistant. Provide comprehensive, detailed, multi-paragraph answers with examples and clear structure when appropriate.",
            },
            ...messages,
          ],
          stream: true,
        }),
      });

      if (response.ok) {
        const headers = new Headers({ ...corsHeaders, "Content-Type": "text/event-stream" });
        headers.set("x-model-used", model);
        return new Response(response.body, { headers });
      }

      // Backoff on 429
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after")) || (attempt + 1) * 800;
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }

      // If credits are low, fall back to a cheaper model once
      if (response.status === 402 && !triedLite) {
        model = "google/gemini-2.5-flash-lite";
        triedLite = true;
        continue;
      }

      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exhausted retries
    return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again shortly." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
