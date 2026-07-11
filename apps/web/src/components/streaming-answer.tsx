'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

// Hold back a trailing markdown marker that hasn't closed yet, so the raw symbols
// (** , ` , a bare # / - , an unclosed link) never flash before they resolve into
// formatted output. Only trims the very end; fully-revealed text renders verbatim.
function stableSlice(full: string, count: number): string {
  if (count >= full.length) return full;
  let s = full.slice(0, count);
  // unclosed inline code
  if (((s.match(/`/g) || []).length) % 2 === 1) {
    const i = s.lastIndexOf('`');
    if (i >= 0) s = s.slice(0, i);
  }
  // unclosed bold
  if (((s.match(/\*\*/g) || []).length) % 2 === 1) {
    const i = s.lastIndexOf('**');
    if (i >= 0) s = s.slice(0, i);
  }
  // a bare heading / list marker at the end with no content yet
  s = s.replace(/(?:^|\n)[ \t]*(?:#{1,6}|[-*+])[ \t]*$/g, '');
  // an unclosed link / image target: [label](partial…
  if (s.lastIndexOf('[') > s.lastIndexOf(')')) {
    const i = s.lastIndexOf('[');
    if (i >= 0) s = s.slice(0, i);
  }
  return s;
}

/**
 * Renders a streaming answer with a steady, eased reveal (Perplexity/Grok-style)
 * layered over bursty token arrival, incremental markdown that never flashes raw
 * syntax, a breathing caret, and a debounced "finalizing" cue for the gap between
 * the last answer token and the governance metadata. Falls back to an instant,
 * static render under prefers-reduced-motion or for already-complete history.
 */
export function StreamingAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  const reduced = usePrefersReducedMotion();
  // History (mounted already complete) shows instantly; a live turn types out.
  const [revealed, setRevealed] = useState(() => (streaming ? 0 : text.length));

  const targetRef = useRef(text.length);
  targetRef.current = text.length;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;

  useEffect(() => {
    if (reduced) {
      setRevealed(targetRef.current);
      return;
    }
    let raf = 0;
    let stopped = false;
    const tick = () => {
      let done = false;
      setRevealed((cur) => {
        const target = targetRef.current;
        if (cur >= target) {
          // Caught up: keep the loop alive while streaming (more may arrive),
          // but let it stop once the stream has closed.
          done = !streamingRef.current;
          return cur;
        }
        const pending = target - cur;
        // Ease-out: reveal more when far behind a burst, gentler as it catches up.
        const step = Math.min(Math.max(2, Math.ceil(pending / 8)), 48);
        return Math.min(target, cur + step);
      });
      if (done || stopped) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // Reduced-motion: keep pinned to the full text as it grows.
  useEffect(() => {
    if (reduced) setRevealed(text.length);
  }, [reduced, text.length]);

  // Completion guarantee. requestAnimationFrame is paused while the tab is
  // hidden, so the paced reveal can freeze mid-answer. Once the stream ends (or
  // whenever the tab is hidden, where the animation can't be seen anyway), snap
  // to the full text so a backgrounded tab never leaves the answer truncated.
  useEffect(() => {
    const finish = () => setRevealed((cur) => (cur < targetRef.current ? targetRef.current : cur));
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', onVisibility);
    let timer: number | undefined;
    if (!streaming) {
      // Let the smooth drain run when visible; hard-guarantee shortly after.
      timer = window.setTimeout(finish, 1200);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [streaming, text.length]);

  const caughtUp = revealed >= text.length;
  const shown = reduced ? text : stableSlice(text, revealed);
  const showCaret = streaming || !caughtUp;

  // "Finalizing" appears only once the visible answer has fully caught up while the
  // stream is still open (the governance/classification pass) — debounced so brief
  // network pauses mid-answer don't flash it.
  const [finalizing, setFinalizing] = useState(false);
  useEffect(() => {
    if (streaming && caughtUp && text.length > 0) {
      const t = setTimeout(() => setFinalizing(true), 650);
      return () => clearTimeout(t);
    }
    setFinalizing(false);
    return undefined;
  }, [streaming, caughtUp, text.length]);

  return (
    <div className="answer-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
      {showCaret ? <span className={`stream-caret${finalizing ? ' pulse' : ''}`} aria-hidden="true" /> : null}
      {finalizing ? (
        <span className="cs-finalizing" aria-live="polite">
          <span className="cs-finalizing-dot" />
          Finalizing
        </span>
      ) : null}
    </div>
  );
}
