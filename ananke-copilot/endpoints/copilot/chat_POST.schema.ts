import { z } from "zod";

export const schema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ),
});

export type InputType = z.infer<typeof schema>;
export type OutputType = string; // Plain text stream

export const postChat = async (body: InputType, init?: RequestInit): Promise<Response> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/copilot/chat`, {
    method: "POST",
    body: JSON.stringify(validatedInput),
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!result.ok) {
    const errorText = await result.text();
    throw new Error(errorText);
  }
  return result; // Returns the raw streaming response
};