import { useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export function useCopilotChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = async (content: string) => {
    const userMsg: ChatMessage = {
      id: Date.now().toString() + "-user",
      role: "user",
      content,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setError(null);

    const requestMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await fetch("/_api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages }),
      });

      if (!res.ok) {
        let errMsg = `Error ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody.error) errMsg = errBody.error;
        } catch (e) {
          errMsg = await res.text();
        }
        throw new Error(errMsg);
      }

      if (!res.body) throw new Error("No response body returned from server.");

      const assistantId = Date.now().toString() + "-assistant";
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const newMsgs = [...prev];
            const lastMsgIndex = newMsgs.length - 1;
            if (newMsgs[lastMsgIndex].id === assistantId) {
              newMsgs[lastMsgIndex] = {
                ...newMsgs[lastMsgIndex],
                content: newMsgs[lastMsgIndex].content + chunk,
              };
            }
            return newMsgs;
          });
        }
      }

      setMessages((prev) => {
        const newMsgs = [...prev];
        const lastMsgIndex = newMsgs.length - 1;
        if (newMsgs[lastMsgIndex].id === assistantId) {
          newMsgs[lastMsgIndex] = {
            ...newMsgs[lastMsgIndex],
            isStreaming: false,
          };
        }
        return newMsgs;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsStreaming(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return { messages, sendMessage, isStreaming, error, clearChat };
}