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
    chatMode,
    setChatMode,
    conversationId,
    conversations,
    selectConversation,
    newConversation,
    deleteConversation,
    isLoadingConversations,
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
        chatMode={chatMode}
        setChatMode={setChatMode}
        conversationId={conversationId}
        conversations={conversations}
        selectConversation={selectConversation}
        newConversation={newConversation}
        deleteConversation={deleteConversation}
        isLoadingConversations={isLoadingConversations}
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
          chatMode={chatMode}
        />
        
        {messages.length > 0 && (
          <Composer
            input={input}
            setInput={setInput}
            onSend={handleSend}
            isThinking={isThinking}
            onToggleThinking={() => setIsThinking((v) => !v)}
            chatMode={chatMode}
          />
        )}
      </div>
    </div>
  );
}
