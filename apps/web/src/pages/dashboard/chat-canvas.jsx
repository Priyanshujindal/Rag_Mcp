import React, { useState } from "react";
import { useChat } from "@/hooks/use-chat";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import "./chat-canvas.css";

export default function ChatCanvas() {
  const [selectedProvider, setSelectedProvider] = useState("gemini");
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");

  const {
    messages,
    input,
    setInput,
    isTyping,
    isThinking,
    setIsThinking,
    copiedId,
    messagesEndRef,
    handleSend,
    handleCopy,
    knowledgeBaseId,
    setKnowledgeBaseId,
  } = useChat({
    provider: selectedProvider,
    model: selectedModel,
  });

  return (
    <div className="chatgpt-canvas-container">
      <ChatHeader
        selectedProvider={selectedProvider}
        setSelectedProvider={setSelectedProvider}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        knowledgeBaseId={knowledgeBaseId}
        setKnowledgeBaseId={setKnowledgeBaseId}
      />
      
      <div className="chat-canvas-body">
        <MessageList
          messages={messages}
          isTyping={isTyping}
          copiedId={copiedId}
          onCopy={handleCopy}
          messagesEndRef={messagesEndRef}
          input={input}
          setInput={setInput}
          onSend={handleSend}
          isThinking={isThinking}
          onToggleThinking={() => setIsThinking((v) => !v)}
        />
        
        {messages.length > 0 && (
          <Composer
            input={input}
            setInput={setInput}
            onSend={handleSend}
            isThinking={isThinking}
            onToggleThinking={() => setIsThinking((v) => !v)}
          />
        )}
      </div>
    </div>
  );
}
