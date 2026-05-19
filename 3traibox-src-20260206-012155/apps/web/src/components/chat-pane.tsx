'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { Surface } from './ui/surface';

export type ChatMessageLike = {
  id?: string;
  message_id?: string;
  role: 'user' | 'assistant' | 'system' | (string & {});
  text: string;
  created_at?: string;
};

export function ChatPane({
  title,
  subtitle,
  messages,
  placeholder = 'Describe your trade…',
  disabled,
  onSend
}: {
  title: string;
  subtitle?: string;
  messages: ChatMessageLike[];
  placeholder?: string;
  disabled?: boolean;
  onSend: (text: string) => Promise<void> | void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');

  const items = useMemo(() => {
    return (messages ?? []).map((m, idx) => ({
      key: m.message_id ?? m.id ?? String(idx),
      role: m.role,
      text: m.text,
      createdAt: m.created_at
    }));
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length]);

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    await onSend(value);
  };

  return (
    <Surface className="min-h-[520px] max-h-[calc(100dvh-56px-48px)] flex flex-col">
      <div className="px-5 py-4 border-b border-border/10">
        <div className="font-semibold">{title}</div>
        {subtitle ? <div className="text-xs text-muted mt-0.5">{subtitle}</div> : null}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-muted">No messages yet.</div>
        ) : (
          items.map((m) => (
            <MessageBubble key={m.key} role={m.role} text={m.text} createdAt={m.createdAt} />
          ))
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-2xl border border-border/10 bg-surface2/40 p-3 flex items-end gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="flex-1 resize-none bg-transparent outline-none text-sm text-ink placeholder:text-muted min-h-[44px] max-h-40"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || text.trim().length === 0}
            className={cn(
              'h-10 w-10 rounded-xl grid place-items-center transition',
              disabled || text.trim().length === 0 ? 'opacity-40' : 'bg-accent text-paper hover:bg-accent/90'
            )}
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-2 text-[11px] text-muted">
          Enter to send • Shift+Enter for newline
        </div>
      </div>
    </Surface>
  );
}

function MessageBubble({ role, text, createdAt }: { role: string; text: string; createdAt?: string }) {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const ts = createdAt ? new Date(createdAt).toLocaleTimeString() : null;
  return (
    <div className={cn('flex', isSystem ? 'justify-center' : isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm border',
          isSystem
            ? 'bg-surface2/40 border-border/10 text-muted'
            : isUser
              ? 'bg-ink text-paper border-border/10'
              : 'bg-surface2/40 border-border/10 text-ink'
        )}
      >
        <div className="whitespace-pre-wrap leading-relaxed">{text}</div>
        {ts ? <div className={cn('mt-2 text-[11px]', isUser ? 'text-paper/60' : 'text-muted')}>{ts}</div> : null}
      </div>
    </div>
  );
}
