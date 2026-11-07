import React, { useState } from "react";

export function Tabs({ children, defaultTab, className = "" }) {
  const [active, setActive] = useState(defaultTab);

  return (
    <div className={`tabs ${className}`}>
      {React.Children.map(children, (child) => {
        if (!child) return null;
        if (child.type === TabsList) {
          return React.cloneElement(child, { activeTab: active, onTabChange: setActive });
        }
        if (child.type === TabsContent) {
          return React.cloneElement(child, { activeTab: active });
        }
        return child;
      })}
    </div>
  );
}

export function TabsList({ children, activeTab, onTabChange, className = "" }) {
  return (
    <div className={`tabs-list ${className}`} role="tablist">
      {React.Children.map(children, (child) => {
        if (!child || child.type !== TabsTrigger) return child;
        return React.cloneElement(child, {
          isActive: activeTab === child.props.value,
          onClick: () => onTabChange?.(child.props.value),
        });
      })}
    </div>
  );
}

export function TabsTrigger({ children, value: _value, isActive, onClick, className = "" }) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab-trigger ${isActive ? "active" : ""} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function TabsContent({ children, value, activeTab, className = "" }) {
  if (value !== activeTab) return null;
  return <div className={`tab-content ${className}`}>{children}</div>;
}
