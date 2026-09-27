import type { APIRoute } from "astro";
import { AGENT_PROMPT } from "../lib/prompt";

export const GET: APIRoute = () => new Response(`${AGENT_PROMPT}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
