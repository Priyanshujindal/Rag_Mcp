import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useChat } from "@/hooks/use-chat";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { ArtifactDrawer } from "@/components/chat/ArtifactDrawer";
import { DocumentInspectorModal } from "@/components/chat/DocumentInspectorModal";
import "./chat-canvas.css";

export default function ChatCanvas() {
  const [selectedProvider, setSelectedProvider] = useState(() => {
    try {
      return localStorage.getItem("ragmcp_provider") || "gemini";
    } catch {
      return "gemini";
    }
  });

  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      const storedProvider = localStorage.getItem("ragmcp_provider");
      const storedModel = localStorage.getItem("ragmcp_model");
      if (storedModel) return storedModel;
      return storedProvider === "openrouter"
        ? "nvidia/nemotron-3-ultra-550b-a55b:free"
        : "gemini-3.8-flash";
    } catch {
      return "gemini-3.8-flash";
    }
  });

  const handleProviderChange = (newProvider) => {
    setSelectedProvider(newProvider);
    try {
      localStorage.setItem("ragmcp_provider", newProvider);
    } catch {}

    if (newProvider === "openrouter") {
      const defaultModel = "nvidia/nemotron-3-ultra-550b-a55b:free";
      setSelectedModel(defaultModel);
      try {
        localStorage.setItem("ragmcp_model", defaultModel);
      } catch {}
    } else {
      const defaultModel = "gemini-3.8-flash";
      setSelectedModel(defaultModel);
      try {
        localStorage.setItem("ragmcp_model", defaultModel);
      } catch {}
    }
  };

  const handleModelChange = (newModel) => {
    setSelectedModel(newModel);
    try {
      localStorage.setItem("ragmcp_model", newModel);
    } catch {}

    const isOpenRouterModel =
      newModel.includes("nvidia/") ||
      newModel.includes("openrouter/") ||
      newModel.includes("google/gemma");

    const inferredProvider = isOpenRouterModel ? "openrouter" : "gemini";
    if (inferredProvider !== selectedProvider) {
      setSelectedProvider(inferredProvider);
      try {
        localStorage.setItem("ragmcp_provider", inferredProvider);
      } catch {}
    }
  };

  const {
    messages,
    input,
    setInput,
    attachedFile,
    setAttachedFile,
    attachedFiles,
    setAttachedFiles,
    addAttachedFiles,
    removeAttachedFile,
    isTyping,
    isThinking,
    setIsThinking,
    isWebSearch,
    setIsWebSearch,
    copiedId,
    messagesEndRef,
    handleSend,
    handleEditMessage,
    handleRegenerate,
    handleCopy,
    handleVoiceNotice,
    handleApproveTool,
    handleRejectTool,
    knowledgeBaseId,
    setKnowledgeBaseId,
    chatMode,
    setChatMode,
    conversationId,
    conversations,
    selectConversation,
    newConversation,
    deleteConversation,
    renameConversation,
    togglePinConversation,
    isLoadingConversations,
    isLoadingConversation,
  } = useChat({
    provider: selectedProvider,
    model: selectedModel,
  });

  const { user } = useAuth();
  const [activeArtifact, setActiveArtifact] = useState(null);
  const [inspectingDoc, setInspectingDoc] = useState(null);

  // Listen for artifact preview requests from any CodeBlock or chat stream
  useEffect(() => {
    const handleOpenArtifact = (e) => {
      if (e.detail && e.detail.code) {
        setActiveArtifact(e.detail);
      }
    };
    window.addEventListener("rag:open-artifact", handleOpenArtifact);
    return () => window.removeEventListener("rag:open-artifact", handleOpenArtifact);
  }, []);

  const {
    isListening,
    isSupported: isVoiceSupported,
    toggleListening,
    voiceLangBadge,
    voiceLangLabel,
    toggleVoiceLang,
  } = useSpeechRecognition({
    currentInput: input,
    onTranscript: (spokenText) => {
      setInput(spokenText);
    },
    onError: (errorType, msg) => {
      handleVoiceNotice(errorType, msg);
    },
    user,
  });

  return (
    <div className="chatgpt-canvas-container">
      <ChatHeader
        selectedProvider={selectedProvider}
        setSelectedProvider={handleProviderChange}
        selectedModel={selectedModel}
        setSelectedModel={handleModelChange}
        knowledgeBaseId={knowledgeBaseId}
        setKnowledgeBaseId={setKnowledgeBaseId}
        chatMode={chatMode}
        setChatMode={setChatMode}
        conversationId={conversationId}
        conversations={conversations}
        selectConversation={selectConversation}
        newConversation={newConversation}
        deleteConversation={deleteConversation}
        renameConversation={renameConversation}
        togglePinConversation={togglePinConversation}
        isLoadingConversations={isLoadingConversations}
        messages={messages}
      />
      
      <div className={`chat-canvas-body ${activeArtifact ? "has-artifact-open" : ""}`}>
        <div className="chat-canvas-messages-area">
          <MessageList
            messages={messages}
            isTyping={isTyping}
            copiedId={copiedId}
            onCopy={handleCopy}
            messagesEndRef={messagesEndRef}
            input={input}
            setInput={setInput}
            onSend={handleSend}
            onEditMessage={handleEditMessage}
            onRegenerate={handleRegenerate}
            isThinking={isThinking}
            onToggleThinking={() => setIsThinking((v) => !v)}
            isWebSearch={isWebSearch}
            onToggleWebSearch={() => setIsWebSearch((v) => !v)}
            attachedFile={attachedFile}
            setAttachedFile={setAttachedFile}
            attachedFiles={attachedFiles}
            onAddFiles={addAttachedFiles}
            onRemoveFile={removeAttachedFile}
            onInspectDoc={setInspectingDoc}
            chatMode={chatMode}
            isLoadingConversation={isLoadingConversation}
            isListening={isListening}
            isSupported={isVoiceSupported}
            voiceLangBadge={voiceLangBadge}
            voiceLangLabel={voiceLangLabel}
            onToggleVoiceLang={toggleVoiceLang}
            onToggleListening={() => toggleListening(input)}
            onApproveTool={handleApproveTool}
            onRejectTool={handleRejectTool}
            onPreviewArtifact={setActiveArtifact}
            onAction={(action) => {
              if (action === "request_mic") {
                toggleListening(input);
              }
            }}
          />
          
          {messages.length > 0 && (
            <Composer
              input={input}
              setInput={setInput}
              onSend={handleSend}
              isThinking={isThinking}
              onToggleThinking={() => setIsThinking((v) => !v)}
              isWebSearch={isWebSearch}
              onToggleWebSearch={() => setIsWebSearch((v) => !v)}
              attachedFile={attachedFile}
              setAttachedFile={setAttachedFile}
              attachedFiles={attachedFiles}
              onAddFiles={addAttachedFiles}
              onRemoveFile={removeAttachedFile}
              onInspectDoc={setInspectingDoc}
              chatMode={chatMode}
              isListening={isListening}
              isSupported={isVoiceSupported}
              voiceLangBadge={voiceLangBadge}
              voiceLangLabel={voiceLangLabel}
              onToggleVoiceLang={toggleVoiceLang}
              onToggleListening={() => toggleListening(input)}
            />
          )}
        </div>

        {activeArtifact && (
          <ArtifactDrawer
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
          />
        )}

        {inspectingDoc && (
          <DocumentInspectorModal
            doc={inspectingDoc}
            onClose={() => setInspectingDoc(null)}
          />
        )}
      </div>
    </div>
  );
}
