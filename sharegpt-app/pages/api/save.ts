import { ratelimit } from "@/lib/upstash";
import { customAlphabet } from "nanoid";
import { conn } from "@/lib/planetscale";
import { ConversationProps } from "@/lib/types";
import { truncate } from "@/lib/utils";
import { NextRequest } from "next/server";

export const config = {
  runtime: "experimental-edge",
};

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  7
); // 7-character random string

export default async function handler(req: NextRequest) {
  if (req.headers.get("origin") !== "https://chat.openai.com")
    return new Response("Invalid origin", { status: 400 });

  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200 });
  } else if (req.method === "POST") {
    const { success } = await ratelimit.limit("sharegpt-save-endpoint");
    if (!success) {
      return new Response("Don't DDoS me pls 🥺", { status: 429 });
    }
    const bodyString = await ReadableStreamToString(req.body);
    const html = JSON.parse(bodyString);
    const id = await setRandomKey(html);
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } else {
    return new Response(`Method ${req.method} Not Allowed`, { status: 405 });
  }
}

async function ReadableStreamToString(stream: ReadableStream | null) {
  if (!stream) {
    return "";
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      result += decoder.decode(value);
    }
  }
  return result;
}

async function setRandomKey(
  html: ConversationProps["content"]
): Promise<string> {
  const key = nanoid();
  const currentTime = new Date().toISOString().replace("Z", "");
  const title = html.items[0].value
    ? truncate(html.items[0].value, 180)
    : "Untitled";
  try {
    await conn.execute(
      "INSERT INTO Conversation (id, title, content, updatedAt) VALUES (?, ?, ?, ?)",
      [key, title, JSON.stringify(html), currentTime]
    );
    return key;
  } catch (e) {
    const keyAlreadyExists = JSON.stringify(e).includes("AlreadyExists");
    if (keyAlreadyExists) {
      console.log("Key already exists, trying again...");
      return setRandomKey(html);
    }
    throw e;
  }
}
